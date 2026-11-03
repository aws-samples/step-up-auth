// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Context, APIGatewayProxyEvent } from 'aws-lambda';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { CognitoToken } from '@step-up-auth/auth-utils';
import { SessionClient, StepUpStatusEnum, Session } from '@step-up-auth/auth-sdk';

import { handler } from '../../src/index';
import { signJwt, testJwk } from '../helpers/jwt';

const USER_POOL_ID = 'us-east-1_TESTPOOL1';
const CLIENT_ID = 'testclient';
const ISS = `https://cognito-idp.us-east-1.amazonaws.com/${USER_POOL_ID}`;
const CHALLENGE_ID = 'c1';

// A one-time challenge row as /initiate-auth would have written it: minted for sub-1, created 10s ago.
const challengeRow = (overrides: Partial<Session> = {}): Session => {
  const now = Math.floor(Date.now() / 1000);
  const s = new Session(`challenge#${CHALLENGE_ID}`, 'sub-1', '', '', '', StepUpStatusEnum.STEP_UP_REQUIRED);
  s.createTimestamp = new Date((now - 10) * 1000).toISOString();
  s.lastUpdateTimestamp = s.createTimestamp;
  s.ttl = now + 600;
  return Object.assign(s, overrides);
};

const HEADERS = {
  'Access-Control-Allow-Headers':
    'Content-Type,X-Amz-Date,Authorization,identification,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
};

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

const BASE_EVENT: APIGatewayProxyEvent = {
  body: '', headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false,
  path: '/', pathParameters: {}, queryStringParameters: {}, multiValueQueryStringParameters: {},
  stageVariables: {}, requestContext: {} as any, resource: '',
};
const BASE_CONTEXT: Context = {
  callbackWaitsForEmptyEventLoop: true, functionName: 'step-up-auth-challenge-lambda',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:111111111111:function:step-up-auth-challenge-lambda',
  memoryLimitInMB: '128MB', awsRequestId: '2779be16-fc84-4d32-81f9-0ce97a21dff1',
  logGroupName: '/log/group/path', logStreamName: '/log/stream/path',
  getRemainingTimeInMillis: {} as any, done: {} as any, fail: {} as any, succeed: {} as any,
};

describe('handler', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SendMock = jest.Mock<(...args: any[]) => any>;
  let sendMock: SendMock;
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.COGNITO_USER_POOL_ARN = `arn:aws:cognito-idp:us-east-1:123456789012:userpool/${USER_POOL_ID}`;
    process.env.COGNITO_CLIENT_ID = CLIENT_ID;
    CognitoToken.getVerifier(USER_POOL_ID, 'access', CLIENT_ID).cacheJwks({ keys: [testJwk] });
    CognitoToken.getVerifier(USER_POOL_ID, 'id', CLIENT_ID).cacheJwks({ keys: [testJwk] });
  });

  beforeEach(() => {
    sendMock = ((jest.spyOn(CognitoIdentityProviderClient.prototype, 'send') as unknown) as SendMock).mockClear();
    sendMock.mockResolvedValue({ PreferredMfaSetting: 'SOFTWARE_TOKEN_MFA', UserMFASettingList: ['SOFTWARE_TOKEN_MFA'] });
    jest.spyOn(SessionClient.prototype, 'createSessionWithParams').mockResolvedValue('fresh-jti-1');
    jest.spyOn(SessionClient.prototype, 'getSession').mockResolvedValue(challengeRow());
    jest.spyOn(SessionClient.prototype, 'deleteSession').mockResolvedValue(`challenge#${CHALLENGE_ID}`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv, COGNITO_USER_POOL_ARN: process.env.COGNITO_USER_POOL_ARN, COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID };
  });

  it('returns the correct OPTIONS response', async () => {
    expect(
      await handler({ ...BASE_EVENT, path: '/respond-to-challenge', httpMethod: 'OPTIONS' }, BASE_CONTEXT)
    ).toEqual({ statusCode: 200, headers: HEADERS, body: '{}' });
  });

  for (const [description, headers] of [
    ['neither token', {}],
    ['only an access token', { Authorization: `Bearer ${'x.y.z'}` }],
    ['a non-bearer authorization header', { Authorization: 'Basic zzzz', Identification: 'Bearer a.b.c' }],
  ] as [string, Record<string, string>][]) {
    it('returns UNAUTHENTICATED when passed ' + description, async () => {
      const response = await handler(
        { ...BASE_EVENT, path: '/respond-to-challenge', httpMethod: 'POST', headers }, BASE_CONTEXT);
      expect(response.statusCode).toBe(401);
      expect(response.body).toBe('{"code":"UNAUTHENTICATED"}');
    });
  }

  it('completes step-up for a fresh, challenge-bound, MFA-backed re-authentication', async () => {
    const response = await handler(
      {
        ...BASE_EVENT, path: '/respond-to-challenge', httpMethod: 'POST',
        headers: { authorization: `Bearer ${freshAccess()}`, identification: `Bearer ${freshId()}` },
        body: JSON.stringify({ challengeId: CHALLENGE_ID }),
      },
      BASE_CONTEXT
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ name: 'Status', details: 'Step-up complete' });
  });

  it('rejects when no challengeId is supplied in the body with reason NO_CHALLENGE', async () => {
    const response = await handler(
      {
        ...BASE_EVENT, path: '/respond-to-challenge', httpMethod: 'POST',
        headers: { authorization: `Bearer ${freshAccess()}`, identification: `Bearer ${freshId()}` },
        body: '',
      },
      BASE_CONTEXT
    );
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({ details: 'Step-up failed', reason: 'NO_CHALLENGE' });
  });

  it('rejects a stale re-authentication with reason STALE_AUTH', async () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const response = await handler(
      {
        ...BASE_EVENT, path: '/respond-to-challenge', httpMethod: 'POST',
        headers: { authorization: `Bearer ${freshAccess({ auth_time: stale })}`, identification: `Bearer ${freshId()}` },
        body: JSON.stringify({ challengeId: CHALLENGE_ID }),
      },
      BASE_CONTEXT
    );
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({ details: 'Step-up failed', reason: 'STALE_AUTH' });
  });

  it('returns 400 on any other path', async () => {
    expect(
      await handler({ ...BASE_EVENT, path: '/some-path', httpMethod: 'GET', headers: { Authorization: 'Bearer xyz' } }, BASE_CONTEXT)
    ).toEqual({
      statusCode: 400,
      body: '{"code":1,"message":"unhandled request","type":"request","caused":"handler"}',
      headers: HEADERS,
    });
  });
});
