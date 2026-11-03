// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { CognitoIdentityProviderClient, GetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { CognitoToken } from '@step-up-auth/auth-utils';
import { SessionClient, StepUpStatusEnum } from '@step-up-auth/auth-sdk';

import { ReauthStepUpResponder } from '../../src/ReauthStepUpResponder';
import { signJwt, testJwk } from '../helpers/jwt';

const USER_POOL_ID = 'us-east-1_TESTPOOL1';
const CLIENT_ID = 'testclient';
const ISS = `https://cognito-idp.us-east-1.amazonaws.com/${USER_POOL_ID}`;

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

describe('ReauthStepUpResponder.validate()', () => {
  // Jest 30 types an untyped jest.Mock loosely; type send() to accept mockResolvedValue.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SendMock = jest.Mock<(...args: any[]) => any>;
  let sendMock: SendMock;
  let client: CognitoIdentityProviderClient;
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
    jest.spyOn(SessionClient.prototype, 'createSessionWithParams').mockResolvedValue('fresh-jti-1');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv, COGNITO_USER_POOL_ARN: process.env.COGNITO_USER_POOL_ARN, COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID };
  });

  it('accepts a fresh, bound, MFA-backed re-authentication and records a completed session', async () => {
    const createSpy = jest.spyOn(SessionClient.prototype, 'createSessionWithParams').mockResolvedValue('fresh-jti-1');
    const responder = new ReauthStepUpResponder(freshAccess(), freshId(), client);

    const result = await responder.validate();

    expect(result.ok).toBe(true);
    // GetUser was called with the fresh access token
    expect(sendMock.mock.calls[0][0]).toBeInstanceOf(GetUserCommand);
    // a STEP_UP_COMPLETED session was written keyed by the fresh token's jti
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0]).toBe('fresh-jti-1');
    expect(createSpy.mock.calls[0][5]).toBe(StepUpStatusEnum.STEP_UP_COMPLETED);
  });

  it('rejects a stale authentication (auth_time older than the window)', async () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const responder = new ReauthStepUpResponder(freshAccess({ auth_time: stale }), freshId(), client);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'STALE_AUTH' });
  });

  it('rejects when the access token and id token are for different users', async () => {
    const responder = new ReauthStepUpResponder(freshAccess({ sub: 'sub-1' }), freshId({ sub: 'sub-2' }), client);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'TOKEN_MISMATCH' });
  });

  it('rejects when the user has no MFA factor enabled', async () => {
    sendMock.mockResolvedValue({ PreferredMfaSetting: undefined, UserMFASettingList: [] });
    const responder = new ReauthStepUpResponder(freshAccess(), freshId(), client);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'MFA_NOT_ENROLLED' });
  });

  it('rejects when the Authorization token is not an access token', async () => {
    // pass an id token where the access token is expected
    const responder = new ReauthStepUpResponder(freshId(), freshId(), client);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'BAD_ACCESS_TOKEN' });
  });

  it('rejects when the Identification token is not an id token', async () => {
    const responder = new ReauthStepUpResponder(freshAccess(), freshAccess(), client);

    const result = await responder.validate();

    expect(result).toEqual({ ok: false, reason: 'BAD_ID_TOKEN' });
  });
});
