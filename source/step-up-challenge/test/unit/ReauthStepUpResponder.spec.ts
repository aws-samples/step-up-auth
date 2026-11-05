// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  GetUserPoolMfaConfigCommand } from '@aws-sdk/client-cognito-identity-provider';
import { CognitoToken } from '@step-up-auth/auth-utils';
import { SessionClient, StepUpStatusEnum, Session, RecordNotFoundException } from '@step-up-auth/auth-sdk';

import { ReauthStepUpResponder } from '../../src/ReauthStepUpResponder';
import { signJwt, testJwk } from '../helpers/jwt';

const USER_POOL_ID = 'us-east-1_TESTPOOL1';
const CLIENT_ID = 'testclient';
const ISS = `https://cognito-idp.us-east-1.amazonaws.com/${USER_POOL_ID}`;
const CHALLENGE_ID = 'c1';

const freshAccess = (overrides: Record<string, unknown> = {}): string => {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: 'sub-1', iss: ISS, token_use: 'access', client_id: CLIENT_ID, username: 'alice',
    jti: 'fresh-jti-1', iat: now, exp: now + 3600, auth_time: now, ...overrides,
  });
};
const freshId = (overrides: Record<string, unknown> = {}): string => {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: 'sub-1', iss: ISS, token_use: 'id', aud: CLIENT_ID, 'cognito:username': 'alice',
    iat: now, exp: now + 3600, auth_time: now, ...overrides,
  });
};

// A one-time challenge row as /initiate-auth would have written it: minted for sub-1, created 10s ago.
const challengeRow = (overrides: Partial<Session> = {}): Session => {
  const now = Math.floor(Date.now() / 1000);
  const s = new Session(`challenge#${CHALLENGE_ID}`, 'sub-1', '', '', '', StepUpStatusEnum.STEP_UP_REQUIRED);
  s.createTimestamp = new Date((now - 10) * 1000).toISOString();
  s.lastUpdateTimestamp = s.createTimestamp;
  s.ttl = now + 600;
  return Object.assign(s, overrides);
};

// GetUserPoolMfaConfig for a pool that requires MFA with the authenticator app only (no SMS or email factor)
const POOL_MFA_REQUIRED = { MfaConfiguration: 'ON', SoftwareTokenMfaConfiguration: { Enabled: true } };
// AdminGetUser for a live user who enrolled at first sign-in through MFA_SETUP: Cognito leaves the
// per-user MFA list empty and sets no preferred MFA, although the pool enforces TOTP for this user
const LIVE_USER = { UserAttributes: [{ Name: 'sub', Value: 'sub-1' }], Enabled: true, UserMFASettingList: [] };

describe('ReauthStepUpResponder.validate()', () => {
  // Jest 30 types an untyped jest.Mock loosely; type send() to accept mockResolvedValue.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SendMock = jest.Mock<(...args: any[]) => any>;
  let sendMock: SendMock;
  let client: CognitoIdentityProviderClient;
  let getSessionSpy: ReturnType<typeof jest.spyOn>;
  let consumeSessionSpy: ReturnType<typeof jest.spyOn>;
  let createSpy: ReturnType<typeof jest.spyOn>;
  const originalEnv = { ...process.env };

  /**
   * Route the Cognito send() mock by command class.  A value that is an Error is thrown for that command;
   * any other command is unexpected and rejects.
   */
  const routeSend = (poolMfa: unknown = POOL_MFA_REQUIRED, user: unknown = LIVE_USER): void => {
    sendMock.mockImplementation(async (command: unknown) => {
      const value = command instanceof GetUserPoolMfaConfigCommand ? poolMfa
        : command instanceof AdminGetUserCommand ? user
          : new Error('unexpected Cognito command');
      if (value instanceof Error) {
        throw value;
      }
      return value;
    });
  };

  beforeAll(() => {
    process.env.COGNITO_USER_POOL_ARN = `arn:aws:cognito-idp:us-east-1:123456789012:userpool/${USER_POOL_ID}`;
    process.env.COGNITO_CLIENT_ID = CLIENT_ID;
    process.env.USER_POOL_ID = USER_POOL_ID;
    // prime the JWKS cache for both token-use verifiers so verification runs offline
    CognitoToken.getVerifier(USER_POOL_ID, 'access', CLIENT_ID).cacheJwks({ keys: [testJwk] });
    CognitoToken.getVerifier(USER_POOL_ID, 'id', CLIENT_ID).cacheJwks({ keys: [testJwk] });
  });

  beforeEach(() => {
    sendMock = ((jest.spyOn(CognitoIdentityProviderClient.prototype, 'send') as unknown) as SendMock).mockClear();
    client = new CognitoIdentityProviderClient({ region: 'us-east-1' });
    // default: the pool requires authenticator-app MFA and the token's user is live and enabled
    routeSend();
    createSpy = jest.spyOn(SessionClient.prototype, 'createSessionWithParams').mockResolvedValue('fresh-jti-1');
    getSessionSpy = jest.spyOn(SessionClient.prototype, 'getSession').mockResolvedValue(challengeRow());
    consumeSessionSpy = jest.spyOn(SessionClient.prototype, 'consumeSession').mockResolvedValue(`challenge#${CHALLENGE_ID}`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = {
      ...originalEnv,
      COGNITO_USER_POOL_ARN: process.env.COGNITO_USER_POOL_ARN,
      COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
      USER_POOL_ID,
    };
  });

  it('accepts a fresh, challenge-bound, MFA-backed re-authentication and consumes the challenge', async () => {
    const responder = new ReauthStepUpResponder(freshAccess(), freshId(), client, CHALLENGE_ID);

    const result = await responder.validate();

    expect(result.ok).toBe(true);
    // the challenge was loaded and then atomically consumed so it cannot be replayed
    expect(getSessionSpy).toHaveBeenCalledWith(`challenge#${CHALLENGE_ID}`);
    expect(consumeSessionSpy).toHaveBeenCalledWith(`challenge#${CHALLENGE_ID}`);
    // the pool's MFA configuration and the token's user were read, for this pool and username only
    const commands = sendMock.mock.calls.map(([command]) => command);
    expect(commands).toHaveLength(2);
    const poolCall = commands.find((c) => c instanceof GetUserPoolMfaConfigCommand) as GetUserPoolMfaConfigCommand;
    const userCall = commands.find((c) => c instanceof AdminGetUserCommand) as AdminGetUserCommand;
    expect(poolCall.input).toStrictEqual({ UserPoolId: USER_POOL_ID });
    expect(userCall.input).toStrictEqual({ UserPoolId: USER_POOL_ID, Username: 'alice' });
    // a STEP_UP_COMPLETED session was written keyed by the fresh token's jti
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0]).toBe('fresh-jti-1');
    expect(createSpy.mock.calls[0][5]).toBe(StepUpStatusEnum.STEP_UP_COMPLETED);
  });

  it('rejects when no challenge id is presented (NO_CHALLENGE)', async () => {
    const responder = new ReauthStepUpResponder(freshAccess(), freshId(), client, undefined);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'NO_CHALLENGE' });
    expect(getSessionSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects when the challenge does not exist (NO_CHALLENGE)', async () => {
    getSessionSpy.mockRejectedValue(new Error('record not found'));
    const responder = new ReauthStepUpResponder(freshAccess(), freshId(), client, CHALLENGE_ID);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'NO_CHALLENGE' });
    expect(consumeSessionSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects when the challenge was minted for a different user (CHALLENGE_SUB_MISMATCH)', async () => {
    getSessionSpy.mockResolvedValue(challengeRow({ userId: 'sub-2' }));
    const responder = new ReauthStepUpResponder(freshAccess(), freshId(), client, CHALLENGE_ID);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'CHALLENGE_SUB_MISMATCH' });
    expect(consumeSessionSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects the in-window adversary: auth_time before the challenge even though within the recency window (STALE_AUTH)', async () => {
    const now = Math.floor(Date.now() / 1000);
    // challenge created "now"; the presented token authenticated 30s earlier (still within 120s recency)
    getSessionSpy.mockResolvedValue(challengeRow({ createTimestamp: new Date(now * 1000).toISOString() }));
    const responder = new ReauthStepUpResponder(freshAccess({ auth_time: now - 30 }), freshId(), client, CHALLENGE_ID);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'STALE_AUTH' });
    expect(consumeSessionSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects a stale authentication beyond the recency window (STALE_AUTH)', async () => {
    const now = Math.floor(Date.now() / 1000);
    // challenge created long ago, so the after-challenge check passes; recency bound then rejects it
    getSessionSpy.mockResolvedValue(challengeRow({
      createTimestamp: new Date((now - 4000) * 1000).toISOString(),
      ttl: now + 600,
    }));
    const responder = new ReauthStepUpResponder(freshAccess({ auth_time: now - 3600 }), freshId(), client, CHALLENGE_ID);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'STALE_AUTH' });
    expect(consumeSessionSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects when the access token and id token are for different users (TOKEN_MISMATCH)', async () => {
    const responder = new ReauthStepUpResponder(freshAccess({ sub: 'sub-1' }), freshId({ sub: 'sub-2' }), client, CHALLENGE_ID);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'TOKEN_MISMATCH' });
    // sub binding is checked before the challenge is loaded
    expect(getSessionSpy).not.toHaveBeenCalled();
  });

  // ----------------------------------------
  //   check 6: AdminGetUser user binding and the GetUserPoolMfaConfig required-MFA check
  // ----------------------------------------
  describe('MFA check', () => {
    /** the challenge is only consumed on success, so a failed MFA check leaves it intact */
    const expectNothingConsumed = (): void => {
      expect(consumeSessionSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    };

    it('accepts a user enrolled at first sign-in whose MFA list is empty when the pool requires TOTP', async () => {
      routeSend(POOL_MFA_REQUIRED, { ...LIVE_USER, UserMFASettingList: [], PreferredMfaSetting: undefined });

      const result = await new ReauthStepUpResponder(freshAccess(), freshId(), client, CHALLENGE_ID).validate();

      expect(result).toEqual({ ok: true });
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['an OPTIONAL pool, even when the user has a TOTP factor listed',
        { MfaConfiguration: 'OPTIONAL', SoftwareTokenMfaConfiguration: { Enabled: true } },
        { ...LIVE_USER, UserMFASettingList: ['SOFTWARE_TOKEN_MFA'], PreferredMfaSetting: 'SOFTWARE_TOKEN_MFA' }],
      ['a pool with MFA OFF',
        { MfaConfiguration: 'OFF' }, LIVE_USER],
      ['a pool that requires MFA with the authenticator app disabled',
        { MfaConfiguration: 'ON', SoftwareTokenMfaConfiguration: { Enabled: false } }, LIVE_USER],
      ['a pool that requires MFA but also offers an SMS factor',
        { ...POOL_MFA_REQUIRED, SmsMfaConfiguration: { SmsConfiguration: { SnsCallerArn: 'arn:aws:iam::123456789012:role/sms' } } },
        LIVE_USER],
      ['a pool that requires MFA but also offers an email factor',
        { ...POOL_MFA_REQUIRED, EmailMfaConfiguration: { Message: '{####}', Subject: 'code' } }, LIVE_USER],
    ])('rejects %s (MFA_NOT_ENROLLED)', async (_description, poolMfa, user) => {
      routeSend(poolMfa, user);

      const result = await new ReauthStepUpResponder(freshAccess(), freshId(), client, CHALLENGE_ID).validate();

      expect(result).toEqual({ ok: false, reason: 'MFA_NOT_ENROLLED' });
      expectNothingConsumed();
    });

    it('rejects when USER_POOL_ID is unset, without calling Cognito (MFA_CHECK_FAILED)', async () => {
      delete process.env.USER_POOL_ID;

      const result = await new ReauthStepUpResponder(freshAccess(), freshId(), client, CHALLENGE_ID).validate();

      expect(result).toEqual({ ok: false, reason: 'MFA_CHECK_FAILED' });
      expect(sendMock).not.toHaveBeenCalled();
      expectNothingConsumed();
    });

    it('rejects when USER_POOL_ID names a different pool from COGNITO_USER_POOL_ARN (MFA_CHECK_FAILED)', async () => {
      process.env.USER_POOL_ID = 'us-east-1_OTHERPOOL';

      const result = await new ReauthStepUpResponder(freshAccess(), freshId(), client, CHALLENGE_ID).validate();

      expect(result).toEqual({ ok: false, reason: 'MFA_CHECK_FAILED' });
      expect(sendMock).not.toHaveBeenCalled();
      expectNothingConsumed();
    });

    it('rejects an access token with an empty username, without calling Cognito (MFA_CHECK_FAILED)', async () => {
      const result = await new ReauthStepUpResponder(freshAccess({ username: '' }), freshId(), client, CHALLENGE_ID).validate();

      expect(result).toEqual({ ok: false, reason: 'MFA_CHECK_FAILED' });
      expect(sendMock).not.toHaveBeenCalled();
      expectNothingConsumed();
    });

    it.each([
      ['whose sub attribute differs from the token sub', { ...LIVE_USER, UserAttributes: [{ Name: 'sub', Value: 'sub-2' }] }],
      ['with no sub attribute', { ...LIVE_USER, UserAttributes: [] }],
      ['that is disabled', { ...LIVE_USER, Enabled: false }],
    ])('rejects a user %s (MFA_CHECK_FAILED)', async (_description, user) => {
      routeSend(POOL_MFA_REQUIRED, user);

      const result = await new ReauthStepUpResponder(freshAccess(), freshId(), client, CHALLENGE_ID).validate();

      expect(result).toEqual({ ok: false, reason: 'MFA_CHECK_FAILED' });
      expectNothingConsumed();
    });

    it.each([
      ['GetUserPoolMfaConfig', () => routeSend(new Error('AccessDeniedException'), LIVE_USER)],
      ['AdminGetUser', () => routeSend(POOL_MFA_REQUIRED, new Error('UserNotFoundException'))],
    ])('rejects when %s throws (MFA_CHECK_FAILED)', async (_command, arrange) => {
      arrange();

      const result = await new ReauthStepUpResponder(freshAccess(), freshId(), client, CHALLENGE_ID).validate();

      expect(result).toEqual({ ok: false, reason: 'MFA_CHECK_FAILED' });
      expectNothingConsumed();
    });
  });

  it('rejects a concurrent replay of the same challenge so only one completion wins (CHALLENGE_CONSUME_FAILED)', async () => {
    // two completions race on one challenge: the first consumes it, the second finds it already gone.
    // consumeSession is a single conditional delete, so exactly one caller wins and writes completion.
    consumeSessionSpy
      .mockResolvedValueOnce(`challenge#${CHALLENGE_ID}`)
      .mockRejectedValue(new RecordNotFoundException('challenge already consumed'));

    const first = await new ReauthStepUpResponder(freshAccess(), freshId(), client, CHALLENGE_ID).validate();
    const second = await new ReauthStepUpResponder(freshAccess({ jti: 'fresh-jti-2' }), freshId(), client, CHALLENGE_ID).validate();

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, reason: 'CHALLENGE_CONSUME_FAILED' });
    // only the winning completion wrote a STEP_UP_COMPLETED row
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects when the Authorization token is not an access token (BAD_ACCESS_TOKEN)', async () => {
    const responder = new ReauthStepUpResponder(freshId(), freshId(), client, CHALLENGE_ID);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'BAD_ACCESS_TOKEN' });
  });

  it('rejects when the Identification token is not an id token (BAD_ID_TOKEN)', async () => {
    const responder = new ReauthStepUpResponder(freshAccess(), freshAccess(), client, CHALLENGE_ID);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'BAD_ID_TOKEN' });
  });

  // ----------------------------------------
  //   STEP_UP_CHALLENGE_CLOCK_SKEW (the "authenticated after the challenge" allowance)
  // ----------------------------------------
  describe('challenge clock-skew allowance', () => {
    // a challenge created exactly "now", so an off-by-one-second auth_time exercises the skew edge
    const challengeAtNow = (now: number): Session =>
      challengeRow({ createTimestamp: new Date(now * 1000).toISOString(), ttl: now + 600 });

    it('with the default skew (1), rejects a token authenticated 2s before the challenge', async () => {
      const now = Math.floor(Date.now() / 1000);
      getSessionSpy.mockResolvedValue(challengeAtNow(now));
      const result = await new ReauthStepUpResponder(freshAccess({ auth_time: now - 2 }), freshId(), client, CHALLENGE_ID).validate();
      expect(result).toEqual({ ok: false, reason: 'STALE_AUTH' });
      expect(consumeSessionSpy).not.toHaveBeenCalled();
    });

    it('with the default skew (1), accepts a token authenticated in the same second as the challenge', async () => {
      const now = Math.floor(Date.now() / 1000);
      getSessionSpy.mockResolvedValue(challengeAtNow(now));
      const result = await new ReauthStepUpResponder(freshAccess({ auth_time: now }), freshId(), client, CHALLENGE_ID).validate();
      expect(result.ok).toBe(true);
    });

    it('applies a configured STEP_UP_CHALLENGE_CLOCK_SKEW (3 accepts a token 2s before the challenge)', async () => {
      process.env.STEP_UP_CHALLENGE_CLOCK_SKEW = '3';
      const now = Math.floor(Date.now() / 1000);
      getSessionSpy.mockResolvedValue(challengeAtNow(now));
      const result = await new ReauthStepUpResponder(freshAccess({ auth_time: now - 2 }), freshId(), client, CHALLENGE_ID).validate();
      expect(result.ok).toBe(true);
    });

    it('falls back to the default skew (1) for an invalid or out-of-range value', async () => {
      const now = Math.floor(Date.now() / 1000);
      for (const bad of ['abc', '20', '-1']) {
        process.env.STEP_UP_CHALLENGE_CLOCK_SKEW = bad;
        getSessionSpy.mockResolvedValue(challengeAtNow(now));
        const result = await new ReauthStepUpResponder(freshAccess({ auth_time: now - 2 }), freshId(), client, CHALLENGE_ID).validate();
        expect(result).toEqual({ ok: false, reason: 'STALE_AUTH' });
      }
    });
  });

  // ----------------------------------------
  //   STEP_UP_MAX_REAUTH_AGE (recency bound, range 30-900)
  // ----------------------------------------
  describe('re-authentication max age', () => {
    // a challenge created well before "now", so the after-challenge check always passes and the
    // recency bound is what decides the outcome
    const oldChallenge = (now: number): Session =>
      challengeRow({ createTimestamp: new Date((now - 100) * 1000).toISOString(), ttl: now + 600 });

    it('applies a configured STEP_UP_MAX_REAUTH_AGE (30 rejects a 40s-old authentication)', async () => {
      process.env.STEP_UP_MAX_REAUTH_AGE = '30';
      const now = Math.floor(Date.now() / 1000);
      getSessionSpy.mockResolvedValue(oldChallenge(now));
      const result = await new ReauthStepUpResponder(freshAccess({ auth_time: now - 40 }), freshId(), client, CHALLENGE_ID).validate();
      expect(result).toEqual({ ok: false, reason: 'STALE_AUTH' });
    });

    it('falls back to the default (120) for an out-of-range STEP_UP_MAX_REAUTH_AGE (5 below the floor)', async () => {
      process.env.STEP_UP_MAX_REAUTH_AGE = '5';
      const now = Math.floor(Date.now() / 1000);
      getSessionSpy.mockResolvedValue(oldChallenge(now));
      // a 40s-old authentication is accepted because the invalid 5 falls back to 120, not down to 5
      const result = await new ReauthStepUpResponder(freshAccess({ auth_time: now - 40 }), freshId(), client, CHALLENGE_ID).validate();
      expect(result.ok).toBe(true);
    });
  });

  // ----------------------------------------
  //   STEP_UP_REAUTH_FUTURE_SKEW (future-dated auth_time guard)
  // ----------------------------------------
  describe('future-dated auth_time guard', () => {
    it('tightens the future-dated auth_time guard when STEP_UP_REAUTH_FUTURE_SKEW is lowered to 0', async () => {
      const now = Math.floor(Date.now() / 1000);
      getSessionSpy.mockResolvedValue(challengeRow({ createTimestamp: new Date((now - 10) * 1000).toISOString(), ttl: now + 600 }));
      // the default guard (5) tolerates a token dated 2s ahead of this runtime's clock
      const accepted = await new ReauthStepUpResponder(freshAccess({ auth_time: now + 2 }), freshId(), client, CHALLENGE_ID).validate();
      expect(accepted.ok).toBe(true);
      // with the guard set to 0, the same 2s-ahead token is rejected
      process.env.STEP_UP_REAUTH_FUTURE_SKEW = '0';
      const rejected = await new ReauthStepUpResponder(freshAccess({ auth_time: now + 2 }), freshId(), client, CHALLENGE_ID).validate();
      expect(rejected).toEqual({ ok: false, reason: 'STALE_AUTH' });
    });
  });
});
