// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Context, APIGatewayProxyEvent } from 'aws-lambda';
import { CognitoToken } from '@step-up-auth/auth-utils';
import { SessionClient, StepUpStatusEnum } from '@step-up-auth/auth-sdk';

import { handler } from '../../src/index';
import { signJwt, testJwk } from '../helpers/jwt';

const USER_POOL_ID = 'us-east-1_TESTPOOL1';
const CLIENT_ID = 'testclient';
const ISS = `https://cognito-idp.us-east-1.amazonaws.com/${USER_POOL_ID}`;

const HEADERS = {
  'Access-Control-Allow-Headers':
    'Content-Type,X-Amz-Date,Authorization,identification,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
};

const accessToken = (overrides: Record<string, unknown> = {}): string => {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: 'sub-1', iss: ISS, token_use: 'access', client_id: CLIENT_ID, username: 'alice',
    jti: 'jti-1', iat: now, exp: now + 3600, auth_time: now, ...overrides,
  });
};

const BASE_EVENT: APIGatewayProxyEvent = {
  body: '', headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false,
  path: '/', pathParameters: {}, queryStringParameters: {}, multiValueQueryStringParameters: {},
  stageVariables: {}, requestContext: {} as any, resource: '',
};
const BASE_CONTEXT: Context = {
  callbackWaitsForEmptyEventLoop: true, functionName: 'step-up-auth-initiate-lambda',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:111111111111:function:step-up-auth-initiate-lambda',
  memoryLimitInMB: '128MB', awsRequestId: '2779be16-fc84-4d32-81f9-0ce97a21dff1',
  logGroupName: '/log/group/path', logStreamName: '/log/stream/path',
  getRemainingTimeInMillis: {} as any, done: {} as any, fail: {} as any, succeed: {} as any,
};

// POST /initiate-auth event.  `claimsSub` is the subject the API Gateway Cognito authorizer put on the
// request context after verifying the id token; pass null to omit the authorizer claims entirely.
const initiateEvent = (headers: Record<string, string | undefined>, claimsSub: string | null = 'sub-1'): APIGatewayProxyEvent => ({
  ...BASE_EVENT,
  path: '/initiate-auth',
  httpMethod: 'POST',
  headers,
  requestContext: (claimsSub === null ? {} : { authorizer: { claims: { sub: claimsSub } } }) as any,
});

describe('handler', () => {
  let createSpy: ReturnType<typeof jest.spyOn>;
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.COGNITO_USER_POOL_ARN = `arn:aws:cognito-idp:us-east-1:123456789012:userpool/${USER_POOL_ID}`;
    process.env.COGNITO_CLIENT_ID = CLIENT_ID;
    // prime the JWKS cache so the handler's access-token verification runs offline
    CognitoToken.getVerifier(USER_POOL_ID, 'access', CLIENT_ID).cacheJwks({ keys: [testJwk] });
  });

  beforeEach(() => {
    // the handler mints the challenge via createChallengeSession, which writes an explicit, uncapped ttl
    createSpy = jest
      .spyOn(SessionClient.prototype, 'createChallengeSession')
      .mockResolvedValue('challenge#created');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv, COGNITO_USER_POOL_ARN: process.env.COGNITO_USER_POOL_ARN, COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID };
  });

  it('returns the correct OPTIONS response', async () => {
    expect(
      await handler({ ...BASE_EVENT, path: '/initiate-auth', httpMethod: 'OPTIONS' }, BASE_CONTEXT)
    ).toEqual({ statusCode: 200, headers: HEADERS, body: '{}' });
  });

  for (const [description, value] of [
    ['no authorization header', undefined],
    ['a non-bearer authorization header', 'Basic zzzz'],
    ['an invalid access token', 'Bearer #*!'],
  ] as [string, string | undefined][]) {
    it('returns UNAUTHENTICATED when passed ' + description, async () => {
      expect(
        await handler(initiateEvent({ Authorization: value }), BASE_CONTEXT)
      ).toEqual({ statusCode: 401, headers: HEADERS, body: '{"code":"UNAUTHENTICATED"}' });
      expect(createSpy).not.toHaveBeenCalled();
    });
  }

  it('returns UNAUTHENTICATED when the bearer token cannot be verified as an access token', async () => {
    // 'xyz' passes the bearer regex but is not a verifiable JWT, so no verified sub can be read
    const response = await handler(initiateEvent({ Authorization: 'Bearer xyz' }), BASE_CONTEXT);
    expect(response).toEqual({ statusCode: 401, headers: HEADERS, body: '{"code":"UNAUTHENTICATED"}' });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('returns UNAUTHENTICATED when the request context carries no authorized subject', async () => {
    const response = await handler(initiateEvent({ Authorization: `Bearer ${accessToken()}` }, null), BASE_CONTEXT);
    expect(response).toEqual({ statusCode: 401, headers: HEADERS, body: '{"code":"UNAUTHENTICATED"}' });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('cannot mint a victim challenge: rejects when the access-token subject differs from the authorized id-token subject', async () => {
    // attacker is authorized by the gateway for their own id token (sub-attacker) but presents a
    // (validly signed) access token for the victim (sub-victim) in the Authorization header
    const response = await handler(
      initiateEvent({ Authorization: `Bearer ${accessToken({ sub: 'sub-victim' })}` }, 'sub-attacker'),
      BASE_CONTEXT
    );
    expect(response).toEqual({ statusCode: 401, headers: HEADERS, body: '{"code":"UNAUTHENTICATED"}' });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('returns REAUTH_REQUIRED with a challengeId and writes a one-time challenge row for the authorized subject', async () => {
    const response = await handler(
      initiateEvent({ Authorization: `Bearer ${accessToken()}` }), BASE_CONTEXT);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('REAUTH_REQUIRED');
    expect(typeof body.challengeId).toBe('string');
    expect(body.challengeId.length).toBeGreaterThan(0);

    // a challenge row was written, keyed challenge#<challengeId>, for this user's sub, STEP_UP_REQUIRED
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0]).toBe(`challenge#${body.challengeId}`);
    expect(createSpy.mock.calls[0][1]).toBe('sub-1');
    expect(createSpy.mock.calls[0][2]).toBe(StepUpStatusEnum.STEP_UP_REQUIRED);
    // a short, future expiry is passed so the challenge does not linger
    const nowInSeconds = Math.floor(Date.now() / 1000);
    expect(createSpy.mock.calls[0][3]).toBeGreaterThan(nowInSeconds);
  });

  it('writes the challenge with the default STEP_UP_CHALLENGE_TTL (600s) and never via the ttl-capped path', async () => {
    const capSpy = jest.spyOn(SessionClient.prototype, 'createSessionWithParams');
    const now = Math.floor(Date.now() / 1000);
    const response = await handler(initiateEvent({ Authorization: `Bearer ${accessToken()}` }), BASE_CONTEXT);

    expect(response.statusCode).toBe(200);
    // ttl is creation + 600 by default, written through the explicit-ttl method (not the capped one)
    expect(createSpy.mock.calls[0][3]).toBeGreaterThanOrEqual(now + 600);
    expect(createSpy.mock.calls[0][3]).toBeLessThanOrEqual(now + 602);
    expect(capSpy).not.toHaveBeenCalled();
  });

  it('honours a valid STEP_UP_CHALLENGE_TTL', async () => {
    process.env.STEP_UP_CHALLENGE_TTL = '300';
    const now = Math.floor(Date.now() / 1000);
    await handler(initiateEvent({ Authorization: `Bearer ${accessToken()}` }), BASE_CONTEXT);
    expect(createSpy.mock.calls[0][3]).toBeGreaterThanOrEqual(now + 300);
    expect(createSpy.mock.calls[0][3]).toBeLessThanOrEqual(now + 302);
  });

  it('falls back to 600 for an invalid or out-of-range STEP_UP_CHALLENGE_TTL', async () => {
    for (const bad of ['abc', '30', '1000', '-5', '600s']) {
      createSpy.mockClear();
      process.env.STEP_UP_CHALLENGE_TTL = bad;
      const now = Math.floor(Date.now() / 1000);
      await handler(initiateEvent({ Authorization: `Bearer ${accessToken()}` }), BASE_CONTEXT);
      expect(createSpy.mock.calls[0][3]).toBeGreaterThanOrEqual(now + 600);
      expect(createSpy.mock.calls[0][3]).toBeLessThanOrEqual(now + 602);
    }
  });

  it('accepts a lowercase bearer authorization header (Amplify v6)', async () => {
    const response = await handler(
      initiateEvent({ authorization: `Bearer ${accessToken()}` }), BASE_CONTEXT);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).code).toBe('REAUTH_REQUIRED');
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('fails closed with 500 when the challenge cannot be written', async () => {
    createSpy.mockRejectedValue(new Error('dynamodb down'));
    const response = await handler(
      initiateEvent({ Authorization: `Bearer ${accessToken()}` }), BASE_CONTEXT);
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).code).toBe('CHALLENGE_CREATE_FAILED');
  });

  it('returns NOT_FOUND on any other path', async () => {
    expect(
      await handler(
        { ...BASE_EVENT, path: '/some-path', httpMethod: 'GET', headers: { Authorization: `Bearer ${accessToken()}` } },
        BASE_CONTEXT
      )
    ).toEqual({ statusCode: 404, headers: HEADERS, body: '{"code":"NOT_FOUND"}' });
  });
});
