// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { CognitoIdentityProviderClient, GetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { CognitoToken } from '@step-up-auth/auth-utils';
import { SessionClient, StepUpStatusEnum, Session } from '@step-up-auth/auth-sdk';

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

describe('ReauthStepUpResponder.validate()', () => {
  // Jest 30 types an untyped jest.Mock loosely; type send() to accept mockResolvedValue.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SendMock = jest.Mock<(...args: any[]) => any>;
  let sendMock: SendMock;
  let client: CognitoIdentityProviderClient;
  let getSessionSpy: ReturnType<typeof jest.spyOn>;
  let deleteSessionSpy: ReturnType<typeof jest.spyOn>;
  let createSpy: ReturnType<typeof jest.spyOn>;
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.COGNITO_USER_POOL_ARN = `arn:aws:cognito-idp:us-east-1:123456789012:userpool/${USER_POOL_ID}`;
    process.env.COGNITO_CLIENT_ID = CLIENT_ID;
    // prime the JWKS cache for both token-use verifiers so verification runs offline
    CognitoToken.getVerifier(USER_POOL_ID, 'access', CLIENT_ID).cacheJwks({ keys: [testJwk] });
    CognitoToken.getVerifier(USER_POOL_ID, 'id', CLIENT_ID).cacheJwks({ keys: [testJwk] });
  });

  beforeEach(() => {
    sendMock = ((jest.spyOn(CognitoIdentityProviderClient.prototype, 'send') as unknown) as SendMock).mockClear();
    client = new CognitoIdentityProviderClient({ region: 'us-east-1' });
    // default: user has MFA enabled
    sendMock.mockResolvedValue({ PreferredMfaSetting: 'SOFTWARE_TOKEN_MFA', UserMFASettingList: ['SOFTWARE_TOKEN_MFA'] });
    createSpy = jest.spyOn(SessionClient.prototype, 'createSessionWithParams').mockResolvedValue('fresh-jti-1');
    getSessionSpy = jest.spyOn(SessionClient.prototype, 'getSession').mockResolvedValue(challengeRow());
    deleteSessionSpy = jest.spyOn(SessionClient.prototype, 'deleteSession').mockResolvedValue(`challenge#${CHALLENGE_ID}`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv, COGNITO_USER_POOL_ARN: process.env.COGNITO_USER_POOL_ARN, COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID };
  });

  it('accepts a fresh, challenge-bound, MFA-backed re-authentication and consumes the challenge', async () => {
    const responder = new ReauthStepUpResponder(freshAccess(), freshId(), client, CHALLENGE_ID);

    const result = await responder.validate();

    expect(result.ok).toBe(true);
    // the challenge was loaded and then consumed so it cannot be replayed
    expect(getSessionSpy).toHaveBeenCalledWith(`challenge#${CHALLENGE_ID}`);
    expect(deleteSessionSpy).toHaveBeenCalledWith(`challenge#${CHALLENGE_ID}`);
    // GetUser was called with the fresh access token
    expect(sendMock.mock.calls[0][0]).toBeInstanceOf(GetUserCommand);
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
    expect(deleteSessionSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects when the challenge was minted for a different user (CHALLENGE_SUB_MISMATCH)', async () => {
    getSessionSpy.mockResolvedValue(challengeRow({ userId: 'sub-2' }));
    const responder = new ReauthStepUpResponder(freshAccess(), freshId(), client, CHALLENGE_ID);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'CHALLENGE_SUB_MISMATCH' });
    expect(deleteSessionSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects the in-window adversary: auth_time before the challenge even though within the recency window (STALE_AUTH)', async () => {
    const now = Math.floor(Date.now() / 1000);
    // challenge created "now"; the presented token authenticated 30s earlier (still within 120s recency)
    getSessionSpy.mockResolvedValue(challengeRow({ createTimestamp: new Date(now * 1000).toISOString() }));
    const responder = new ReauthStepUpResponder(freshAccess({ auth_time: now - 30 }), freshId(), client, CHALLENGE_ID);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'STALE_AUTH' });
    expect(deleteSessionSpy).not.toHaveBeenCalled();
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
    expect(deleteSessionSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects when the access token and id token are for different users (TOKEN_MISMATCH)', async () => {
    const responder = new ReauthStepUpResponder(freshAccess({ sub: 'sub-1' }), freshId({ sub: 'sub-2' }), client, CHALLENGE_ID);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'TOKEN_MISMATCH' });
    // sub binding is checked before the challenge is loaded
    expect(getSessionSpy).not.toHaveBeenCalled();
  });

  it('rejects when the user has no MFA factor enabled (MFA_NOT_ENROLLED)', async () => {
    sendMock.mockResolvedValue({ PreferredMfaSetting: undefined, UserMFASettingList: [] });
    const responder = new ReauthStepUpResponder(freshAccess(), freshId(), client, CHALLENGE_ID);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'MFA_NOT_ENROLLED' });
    // the challenge is only consumed on success, so a failed MFA check leaves it intact
    expect(deleteSessionSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
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
});
