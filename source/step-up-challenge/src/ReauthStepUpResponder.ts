// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  StepUpStatusEnum,
  SessionClient,
  Session } from '@step-up-auth/auth-sdk';
import {
  Logger,
  CognitoToken,
  readBoundedIntEnv } from '@step-up-auth/auth-utils';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminGetUserCommandOutput,
  GetUserPoolMfaConfigCommand,
  GetUserPoolMfaConfigCommandOutput } from '@aws-sdk/client-cognito-identity-provider';
import { configuredUserPoolId } from './config';

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
 * `auth_time` is older than this is rejected.  Overridable with the STEP_UP_MAX_REAUTH_AGE env var
 * (whole seconds, 30 to 900 inclusive); a missing or out-of-range value falls back to this default.
 * The range floor (30 s) keeps the window large enough for a real user to finish a password + MFA
 * re-auth, and the ceiling (900 s) stops it being widened into a long-lived replay window.
 */
const DEFAULT_MAX_REAUTH_AGE_SECONDS = 120;
/** Smallest accepted STEP_UP_MAX_REAUTH_AGE (seconds). */
const MIN_MAX_REAUTH_AGE_SECONDS = 30;
/** Largest accepted STEP_UP_MAX_REAUTH_AGE (seconds). */
const MAX_MAX_REAUTH_AGE_SECONDS = 900;

/**
 * Default allowance (seconds) for clock skew between Cognito and this runtime when guarding against an
 * implausibly future-dated `auth_time`.  Overridable with the STEP_UP_REAUTH_FUTURE_SKEW env var
 * (whole seconds, 0 to 10 inclusive); a missing or out-of-range value falls back to this default.
 */
const DEFAULT_REAUTH_FUTURE_SKEW_SECONDS = 5;

/**
 * Default allowance (seconds) for clock skew when requiring that the authentication happened *after*
 * the challenge was created.  Overridable with the STEP_UP_CHALLENGE_CLOCK_SKEW env var (whole seconds,
 * 0 to 10 inclusive); a missing or out-of-range value falls back to this default.
 *
 * This allowance is intentionally small and MUST NEVER be widened toward the re-authentication max age:
 * doing so would accept a token authenticated well before the challenge, re-opening the stolen-token
 * window this control closes.  The default is 1 (not 0) because both `auth_time` and the challenge
 * creation time are whole seconds, so a legitimate re-auth in the same clock second as the challenge
 * would otherwise be rejected by off-by-one rounding.
 */
const DEFAULT_CHALLENGE_CLOCK_SKEW_SECONDS = 1;
/** Smallest accepted STEP_UP_CHALLENGE_CLOCK_SKEW and STEP_UP_REAUTH_FUTURE_SKEW (seconds). */
const MIN_SKEW_SECONDS = 0;
/** Largest accepted STEP_UP_CHALLENGE_CLOCK_SKEW and STEP_UP_REAUTH_FUTURE_SKEW (seconds). */
const MAX_SKEW_SECONDS = 10;

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
 *   6. the tokens belong to a live, enabled user of this pool (AdminGetUser: the user's `sub` attribute
 *      equals the token's `sub`), and the pool requires MFA with the authenticator app (TOTP) as its only
 *      factor (GetUserPoolMfaConfig: MfaConfiguration ON, software token enabled, no SMS or email factor).
 * Why check 6 is enough for "only accept MFA set up before the challenge": MFA is required, the user
 * sets up the authenticator at first sign-in, and the factor can't be changed or turned off afterwards
 * (there is no self-service MFA, and the pre token generation trigger removes the
 * aws.cognito.signin.user.admin scope from every token, so no browser token can register, replace or
 * disable a factor).  The pool does not remember devices, so a re-authentication can't skip MFA.  The
 * fresh sign-in therefore exercised the factor registered at first sign-in, which predates this
 * challenge.  The guarantee is structural, not a timestamp check: Cognito exposes no factor-setup
 * timestamp.  The per-user MFA list from AdminGetUser is not used, because it stays empty for a user who
 * enrolled through the first sign-in MFA_SETUP challenge, even though the pool enforces TOTP for them.
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
  private reauthFutureSkewSeconds: number;
  private challengeClockSkewSeconds: number;

  /**
   * C-TOR
   * @param {string} accessToken fresh Cognito access token (from the re-authentication)
   * @param {string} idToken fresh Cognito id token (from the re-authentication)
   * @param {CognitoIdentityProviderClient} client Cognito client, signed with the function's role, used for
   *   the AdminGetUser user binding and the GetUserPoolMfaConfig required-MFA check (check 6)
   * @param {string} challengeId one-time challenge id returned by `/initiate-auth` (required)
   */
  constructor(accessToken: string, idToken: string, client: CognitoIdentityProviderClient, challengeId?: string) {
    this.accessTokenValue = accessToken;
    this.idTokenValue = idToken;
    this.client = client;
    this.challengeId = challengeId;
    this.maxReauthAgeSeconds = readBoundedIntEnv(
      'STEP_UP_MAX_REAUTH_AGE', DEFAULT_MAX_REAUTH_AGE_SECONDS, MIN_MAX_REAUTH_AGE_SECONDS, MAX_MAX_REAUTH_AGE_SECONDS);
    this.reauthFutureSkewSeconds = readBoundedIntEnv(
      'STEP_UP_REAUTH_FUTURE_SKEW', DEFAULT_REAUTH_FUTURE_SKEW_SECONDS, MIN_SKEW_SECONDS, MAX_SKEW_SECONDS);
    this.challengeClockSkewSeconds = readBoundedIntEnv(
      'STEP_UP_CHALLENGE_CLOCK_SKEW', DEFAULT_CHALLENGE_CLOCK_SKEW_SECONDS, MIN_SKEW_SECONDS, MAX_SKEW_SECONDS);
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
    if (!authTime || authTime <= challengeCreateEpoch - this.challengeClockSkewSeconds) {
      log.warn('step-up rejected: authentication did not occur after the step-up challenge');
      return { ok: false, reason: 'STALE_AUTH' };
    }

    // 5. recency bound: the authentication must also be recent, and not implausibly in the future
    if (nowInSeconds - authTime > this.maxReauthAgeSeconds || authTime > nowInSeconds + this.reauthFutureSkewSeconds) {
      log.warn(`step-up rejected: authentication is not recent (auth_time age exceeds ${this.maxReauthAgeSeconds}s)`);
      return { ok: false, reason: 'STALE_AUTH' };
    }

    // 6. (MFA assurance) bind the tokens to a live, enabled user of this pool, and require that the pool
    //    enforces MFA with the authenticator app as its only factor.  MFA is required, set up at first
    //    sign-in and immutable afterwards (no self-service MFA, and no token carries the
    //    aws.cognito.signin.user.admin scope), so the factor this fresh sign-in exercised predates the
    //    challenge.  Cognito exposes no factor-setup timestamp, so this is guaranteed structurally rather
    //    than by a timestamp check.  The per-user MFA list is not used: it stays empty for a user who
    //    enrolled through the first sign-in MFA_SETUP challenge.  Both calls are authorised by the
    //    function's IAM role, not by the presented token.
    const userPoolId = configuredUserPoolId();
    const username = access.getUsernameClaim();
    if (!userPoolId || !username) {
      log.warn('step-up rejected: the user pool id or the token username is not available for the MFA check');
      return { ok: false, reason: 'MFA_CHECK_FAILED' };
    }
    let poolMfa: GetUserPoolMfaConfigCommandOutput;
    let user: AdminGetUserCommandOutput;
    try {
      poolMfa = await this.client.send(new GetUserPoolMfaConfigCommand({ UserPoolId: userPoolId }));
      user = await this.client.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
    } catch ( e: any ) {
      log.error(`step-up rejected: the MFA check call to Cognito failed - ${e?.name}: ${e?.message}`);
      return { ok: false, reason: 'MFA_CHECK_FAILED' };
    }
    const userSub = user.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value;
    if (userSub !== sub || user.Enabled === false) {
      log.warn('step-up rejected: the token does not belong to a live, enabled user of this pool');
      return { ok: false, reason: 'MFA_CHECK_FAILED' };
    }
    const mfaRequired = poolMfa.MfaConfiguration === 'ON'
      && poolMfa.SoftwareTokenMfaConfiguration?.Enabled === true
      && !poolMfa.SmsMfaConfiguration
      && !poolMfa.EmailMfaConfiguration;
    if (!mfaRequired) {
      log.warn('step-up rejected: the user pool does not require MFA with the authenticator app as its only factor');
      return { ok: false, reason: 'MFA_NOT_ENROLLED' };
    }

    // 7. consume the one-time challenge so it can never be replayed.  consumeSession is a single
    //    conditional delete, so if two completions race on the same challenge exactly one wins here and
    //    goes on to write the completed row; the loser's condition fails and it is rejected.
    try {
      await sessionClient.consumeSession(`challenge#${this.challengeId}`);
    } catch ( e: any ) {
      log.warn(`step-up rejected: challenge already consumed or could not be consumed - ${e?.name}: ${e?.message}`);
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
