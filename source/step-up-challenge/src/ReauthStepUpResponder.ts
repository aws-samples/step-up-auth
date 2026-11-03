// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  StepUpStatusEnum,
  SessionClient,
  Session } from '@step-up-auth/auth-sdk';
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
 * Allowance (seconds) for clock skew when requiring that the authentication happened *after* the
 * challenge was created.  This is intentionally small: it must not be widened into the full
 * re-authentication max age, or a token authenticated well before the challenge would be accepted.
 */
const CHALLENGE_CLOCK_SKEW_SECONDS = 5;

/**
 * Re-authentication step-up responder.
 *
 * Step-up is proven by a *fresh authentication that was prompted by this step-up request*, not by
 * verifying or enrolling an MFA factor.  `/initiate-auth` mints a one-time, server-bound challenge; the
 * client then re-authenticates with Cognito (password via SRP plus the user's existing MFA) and presents
 * the freshly issued tokens together with the `challengeId`.  This responder accepts step-up only when
 * all of the following hold, none of which the holder of a stolen or refreshed token can satisfy:
 *   1. both the access token and the id token verify (signature, exp, iss, token_use, client id/aud);
 *   2. both tokens belong to the same user (`sub` binding);
 *   3. a one-time challenge exists for the presented `challengeId`, has not expired, and was minted for
 *      the same `sub`;
 *   4. the access token's `auth_time` is strictly after that challenge's creation time (small clock-skew
 *      allowance only) — a stolen or refreshed token authenticated before the challenge is rejected;
 *   5. the authentication is also recent (`auth_time` within the allowed window);
 *   6. the user has an MFA factor enabled, so the fresh sign-in necessarily completed MFA (the user pool
 *      does not remember devices, so MFA cannot be silently skipped).
 * On success it consumes the one-time challenge (so it cannot be replayed) and records a
 * STEP_UP_COMPLETED session keyed by the *fresh* access token's `jti`, so the stolen original token
 * never carries a completed session.
 */
class ReauthStepUpResponder {
  private accessTokenValue: string;
  private idTokenValue: string;
  private client: CognitoIdentityProviderClient;
  private challengeId?: string;
  private maxReauthAgeSeconds: number;

  /**
   * C-TOR
   * @param {string} accessToken fresh Cognito access token (from the re-authentication)
   * @param {string} idToken fresh Cognito id token (from the re-authentication)
   * @param {CognitoIdentityProviderClient} client Cognito client used for the GetUser MFA check
   * @param {string} challengeId one-time challenge id returned by `/initiate-auth` (required)
   */
  constructor(accessToken: string, idToken: string, client: CognitoIdentityProviderClient, challengeId?: string) {
    this.accessTokenValue = accessToken;
    this.idTokenValue = idToken;
    this.client = client;
    this.challengeId = challengeId;
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

    // 3. (challenge binding) this completion must correspond to a one-time challenge minted by
    //    `/initiate-auth` for this user.  Without it, "recent authentication" is not "authentication
    //    prompted by this step-up", and a recently stolen/refreshed token would pass on recency alone.
    if (!this.challengeId) {
      log.warn('step-up rejected: no challenge id was presented');
      return { ok: false, reason: 'NO_CHALLENGE' };
    }
    const sessionClient = new SessionClient();
    const nowInSeconds = Math.floor(Date.now() / 1000);
    let challenge: Session;
    try {
      challenge = await sessionClient.getSession(`challenge#${this.challengeId}`);
    } catch ( e: any ) {
      log.warn('step-up rejected: challenge not found');
      return { ok: false, reason: 'NO_CHALLENGE' };
    }
    // treat an expired challenge as absent (DynamoDB TTL deletion is not immediate)
    if (challenge.ttl && challenge.ttl <= nowInSeconds) {
      log.warn('step-up rejected: challenge has expired');
      return { ok: false, reason: 'NO_CHALLENGE' };
    }
    const challengeCreateEpoch = challenge.createTimestamp
      ? Math.floor(new Date(challenge.createTimestamp).getTime() / 1000)
      : NaN;
    if (!Number.isFinite(challengeCreateEpoch)) {
      log.warn('step-up rejected: challenge has no valid creation time');
      return { ok: false, reason: 'NO_CHALLENGE' };
    }
    // the challenge must have been minted for the same user as the presented tokens
    if (challenge.userId !== sub) {
      log.warn('step-up rejected: challenge was minted for a different user');
      return { ok: false, reason: 'CHALLENGE_SUB_MISMATCH' };
    }

    // 4. (A) freshness relative to the challenge: the authentication must be STRICTLY AFTER the challenge
    //    was created (only a small clock-skew allowance).  A stolen token's auth_time predates the
    //    challenge; a refresh does not advance auth_time.  Both are rejected here.
    const authTime = access.getAuthTimeClaim();
    if (!authTime || authTime <= challengeCreateEpoch - CHALLENGE_CLOCK_SKEW_SECONDS) {
      log.warn('step-up rejected: authentication did not occur after the step-up challenge');
      return { ok: false, reason: 'STALE_AUTH' };
    }

    // 5. recency bound: the authentication must also be recent, and not implausibly in the future
    if (nowInSeconds - authTime > this.maxReauthAgeSeconds || authTime > nowInSeconds + CLOCK_SKEW_SECONDS) {
      log.warn(`step-up rejected: authentication is not recent (auth_time age exceeds ${this.maxReauthAgeSeconds}s)`);
      return { ok: false, reason: 'STALE_AUTH' };
    }

    // 6. (MFA assurance) the user must have an MFA factor enabled, so the fresh sign-in necessarily
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

    // 7. consume the one-time challenge so it can never be replayed
    try {
      await sessionClient.deleteSession(`challenge#${this.challengeId}`);
    } catch ( e: any ) {
      log.error(`step-up rejected: unable to consume challenge - ${e?.name}: ${e?.message}`);
      return { ok: false, reason: 'CHALLENGE_CONSUME_FAILED' };
    }

    // 8. success: record a completed step-up session keyed by THIS fresh token's jti.  ttl is capped at
    //    the access token's own expiry by the SDK, so the session never outlives the token.
    try {
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
