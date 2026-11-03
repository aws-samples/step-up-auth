// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  StepUpStatusEnum,
  SessionClient } from '@step-up-auth/auth-sdk';
import {
  Logger,
  CognitoToken } from '@step-up-auth/auth-utils';
import {
  CognitoIdentityProviderClient,
  GetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

/**
 * Outcome of a step-up attempt.  `reason` is a short machine-readable code (no secrets) that the
 * client can map to a message; it is never a raw error or token value.
 */
export interface StepUpResult {
  ok: boolean;
  reason?: string;
}

/**
 * Default maximum age, in seconds, of the re-authentication that step-up will accept.  A token whose
 * `auth_time` is older than this is rejected.  Overridable with the STEP_UP_MAX_REAUTH_AGE env var.
 */
const DEFAULT_MAX_REAUTH_AGE_SECONDS = 120;
/** Small allowance (seconds) for clock skew between Cognito and this runtime. */
const CLOCK_SKEW_SECONDS = 5;

/**
 * Re-authentication step-up responder.
 *
 * Step-up is proven by a *fresh authentication*, not by verifying or enrolling an MFA factor.  The
 * client re-authenticates with Cognito (password via SRP plus the user's existing MFA) and presents the
 * freshly issued tokens.  This responder accepts step-up only when all of the following hold, none of
 * which the holder of a stolen or refreshed token can satisfy:
 *   1. both the access token and the id token verify (signature, exp, iss, token_use, client id/aud);
 *   2. both tokens belong to the same user (`sub` binding);
 *   3. the access token comes from a recent authentication (`auth_time` within the allowed window) —
 *      a stolen token's `auth_time` is old, and a refresh does not advance it;
 *   4. the user has an MFA factor enabled, so the fresh sign-in necessarily completed MFA (the user
 *      pool does not remember devices, so MFA cannot be silently skipped).
 * On success it records a STEP_UP_COMPLETED session keyed by the *fresh* access token's `jti`, so the
 * stolen original token never carries a completed session.
 */
class ReauthStepUpResponder {
  private accessTokenValue: string;
  private idTokenValue: string;
  private client: CognitoIdentityProviderClient;
  private maxReauthAgeSeconds: number;

  /**
   * C-TOR
   * @param {string} accessToken fresh Cognito access token (from the re-authentication)
   * @param {string} idToken fresh Cognito id token (from the re-authentication)
   * @param {CognitoIdentityProviderClient} client Cognito client used for the GetUser MFA check
   */
  constructor(accessToken: string, idToken: string, client: CognitoIdentityProviderClient) {
    this.accessTokenValue = accessToken;
    this.idTokenValue = idToken;
    this.client = client;
    const configured = Number(process.env.STEP_UP_MAX_REAUTH_AGE);
    this.maxReauthAgeSeconds = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_REAUTH_AGE_SECONDS;
  }

  /**
   * Validate the re-authentication and, on success, mark step-up complete.
   * @returns {StepUpResult} ok=true and a completed session on success; ok=false with a reason otherwise
   */
  public async validate(): Promise<StepUpResult> {
    const access = new CognitoToken(this.accessTokenValue);
    const id = new CognitoToken(this.idTokenValue);

    // 1. verify both tokens cryptographically (signature, exp, iss, token_use, client id/aud)
    let accessIsAccess: boolean;
    let idIsId: boolean;
    try {
      accessIsAccess = access.isAccessToken();
      idIsId = id.isIdToken();
    } catch ( e ) {
      log.warn('step-up rejected: a presented token could not be decoded');
      return { ok: false, reason: 'BAD_TOKEN' };
    }
    if (!accessIsAccess) {
      log.warn('step-up rejected: Authorization header is not an access token');
      return { ok: false, reason: 'BAD_ACCESS_TOKEN' };
    }
    if (!idIsId) {
      log.warn('step-up rejected: Identification header is not an id token');
      return { ok: false, reason: 'BAD_ID_TOKEN' };
    }
    if (!(await access.verify('access'))) {
      log.warn('step-up rejected: access token failed verification');
      return { ok: false, reason: 'BAD_ACCESS_TOKEN' };
    }
    if (!(await id.verify('id'))) {
      log.warn('step-up rejected: id token failed verification');
      return { ok: false, reason: 'BAD_ID_TOKEN' };
    }

    // 2. (D) bind the two tokens to the SAME user
    const sub = access.getSubClaim();
    if (!sub || sub !== id.getSubClaim()) {
      log.warn('step-up rejected: access token and id token are for different users');
      return { ok: false, reason: 'TOKEN_MISMATCH' };
    }

    // 3. (A) the access token must come from a FRESH authentication.  A stolen token's auth_time is
    //    old; a refreshed token keeps the old auth_time.  Both are rejected here.
    const authTime = access.getAuthTimeClaim();
    const nowInSeconds = Math.floor(Date.now() / 1000);
    if (!authTime || nowInSeconds - authTime > this.maxReauthAgeSeconds || authTime > nowInSeconds + CLOCK_SKEW_SECONDS) {
      log.warn(`step-up rejected: authentication is not recent (auth_time age exceeds ${this.maxReauthAgeSeconds}s)`);
      return { ok: false, reason: 'STALE_AUTH' };
    }

    // 4. (MFA assurance) the user must have an MFA factor enabled, so the fresh sign-in necessarily
    //    exercised it.  GetUser is authorised by the fresh access token.
    let mfaEnabled = false;
    try {
      const user = await this.client.send(new GetUserCommand({ AccessToken: access.getToken() }));
      mfaEnabled = !!user.PreferredMfaSetting || (user.UserMFASettingList !== undefined && user.UserMFASettingList.length > 0);
    } catch ( e: any ) {
      log.error(`step-up rejected: GetUser failed - ${e?.name}: ${e?.message}`);
      return { ok: false, reason: 'MFA_CHECK_FAILED' };
    }
    if (!mfaEnabled) {
      log.warn('step-up rejected: user has no MFA factor enabled');
      return { ok: false, reason: 'MFA_NOT_ENROLLED' };
    }

    // 5. success: record a completed step-up session keyed by THIS fresh token's jti.  ttl is capped at
    //    the access token's own expiry by the SDK, so the session never outlives the token.
    try {
      const sessionClient = new SessionClient();
      await sessionClient.createSessionWithParams(
        access.getJtiClaim(),
        access.getUsernameClaim(),
        access.getClientIdClaim(),
        undefined,
        '',
        StepUpStatusEnum.STEP_UP_COMPLETED,
        access.getExpClaim(),
      );
    } catch ( e: any ) {
      log.error(`step-up rejected: unable to record completed session - ${e?.name}: ${e?.message}`);
      return { ok: false, reason: 'SESSION_WRITE_FAILED' };
    }

    log.debug('step-up complete: fresh re-authentication accepted and session recorded');
    return { ok: true };
  }
}

export { ReauthStepUpResponder };
