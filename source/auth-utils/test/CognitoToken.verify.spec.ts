// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { CognitoToken } from '../lib/CognitoToken';
import { signJwt, testJwk } from './helpers/jwt';

const USER_POOL_ID = 'us-east-1_TESTPOOL1';
const USER_POOL_ARN = `arn:aws:cognito-idp:us-east-1:123456789012:userpool/${USER_POOL_ID}`;
const ISSUER = `https://cognito-idp.us-east-1.amazonaws.com/${USER_POOL_ID}`;
const CLIENT_ID = 'testclient';

const accessClaims = (overrides: Record<string, unknown> = {}): Record<string, unknown> => {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'sub-1',
    iss: ISSUER,
    token_use: 'access',
    scope: 'aws.cognito.signin.user.admin',
    auth_time: now,
    exp: now + 3600,
    iat: now,
    jti: 'jti-1',
    client_id: CLIENT_ID,
    username: 'alice',
    ...overrides,
  };
};

describe('CognitoToken.verify() with aws-jwt-verify', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    // prime the JWKS cache of the verifier that verify() uses, so no network call is made
    CognitoToken.getVerifier(USER_POOL_ID, 'access', CLIENT_ID).cacheJwks({ keys: [testJwk] });
  });

  beforeEach(() => {
    process.env.COGNITO_USER_POOL_ARN = USER_POOL_ARN;
    process.env.COGNITO_CLIENT_ID = CLIENT_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns true for a valid access token', async () => {
    const token = new CognitoToken(`Bearer ${signJwt(accessClaims())}`);
    await expect(token.verify('access')).resolves.toBe(true);
    // default token use comes from the token_use claim
    await expect(token.verify()).resolves.toBe(true);
  });

  it('returns false for a tampered payload with the original signature', async () => {
    const [header, , signature] = signJwt(accessClaims()).split('.');
    const tamperedPayload = Buffer.from(JSON.stringify(accessClaims({ username: 'mallory' }))).toString('base64url');
    const token = new CognitoToken(`${header}.${tamperedPayload}.${signature}`);
    await expect(token.verify('access')).resolves.toBe(false);
  });

  it('returns false for an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = new CognitoToken(signJwt(accessClaims({ iat: now - 7200, auth_time: now - 7200, exp: now - 60 })));
    await expect(token.verify('access')).resolves.toBe(false);
  });

  it('returns false for a token issued to another client', async () => {
    const token = new CognitoToken(signJwt(accessClaims({ client_id: 'otherclient' })));
    await expect(token.verify('access')).resolves.toBe(false);
  });

  it('returns false for an id token when an access token is expected', async () => {
    const claims = accessClaims({ token_use: 'id', aud: CLIENT_ID, 'cognito:username': 'alice' });
    delete claims.client_id;
    const token = new CognitoToken(signJwt(claims));
    await expect(token.verify('access')).resolves.toBe(false);
  });

  it('returns false when COGNITO_CLIENT_ID is not set', async () => {
    delete process.env.COGNITO_CLIENT_ID;
    const token = new CognitoToken(signJwt(accessClaims()));
    await expect(token.verify('access')).resolves.toBe(false);
  });

  it('returns false when COGNITO_USER_POOL_ARN is not set', async () => {
    delete process.env.COGNITO_USER_POOL_ARN;
    const token = new CognitoToken(signJwt(accessClaims()));
    await expect(token.verify('access')).resolves.toBe(false);
  });

  it('accepts the client id as constructor argument', async () => {
    delete process.env.COGNITO_CLIENT_ID;
    const token = new CognitoToken(signJwt(accessClaims()), undefined, USER_POOL_ARN, CLIENT_ID);
    await expect(token.verify('access')).resolves.toBe(true);
  });
});
