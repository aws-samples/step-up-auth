// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { Context, APIGatewayProxyEvent } from 'aws-lambda';
import { SessionClient, StepUpStatusEnum } from '@step-up-auth/auth-sdk';

import { handler } from '../../src/index';
import { signJwt } from '../helpers/jwt';

const HEADERS = {
  'Access-Control-Allow-Headers':
    'Content-Type,X-Amz-Date,Authorization,identification,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
};

const accessToken = (overrides: Record<string, unknown> = {}): string => {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: 'sub-1', token_use: 'access', client_id: 'testclient', username: 'alice',
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

describe('handler', () => {
  let createSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    createSpy = jest
      .spyOn(SessionClient.prototype, 'createSessionWithParams')
      .mockResolvedValue('challenge#created');
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
        await handler(
          { ...BASE_EVENT, path: '/initiate-auth', httpMethod: 'POST', headers: { Authorization: value } },
          BASE_CONTEXT
        )
      ).toEqual({ statusCode: 401, headers: HEADERS, body: '{"code":"UNAUTHENTICATED"}' });
      expect(createSpy).not.toHaveBeenCalled();
    });
  }

  it('returns UNAUTHENTICATED when the bearer token has no decodable sub', async () => {
    // 'xyz' passes the bearer regex but is not a decodable JWT, so no sub can be read
    const response = await handler(
      { ...BASE_EVENT, path: '/initiate-auth', httpMethod: 'POST', headers: { Authorization: 'Bearer xyz' } },
      BASE_CONTEXT
    );
    expect(response).toEqual({ statusCode: 401, headers: HEADERS, body: '{"code":"UNAUTHENTICATED"}' });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('returns REAUTH_REQUIRED with a challengeId and writes a one-time challenge row', async () => {
    const response = await handler(
      { ...BASE_EVENT, path: '/initiate-auth', httpMethod: 'POST', headers: { Authorization: `Bearer ${accessToken()}` } },
      BASE_CONTEXT
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('REAUTH_REQUIRED');
    expect(typeof body.challengeId).toBe('string');
    expect(body.challengeId.length).toBeGreaterThan(0);

    // a challenge row was written, keyed challenge#<challengeId>, for this user's sub, STEP_UP_REQUIRED
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0]).toBe(`challenge#${body.challengeId}`);
    expect(createSpy.mock.calls[0][1]).toBe('sub-1');
    expect(createSpy.mock.calls[0][5]).toBe(StepUpStatusEnum.STEP_UP_REQUIRED);
    // a short, future expiry is passed so the challenge does not linger
    const nowInSeconds = Math.floor(Date.now() / 1000);
    expect(createSpy.mock.calls[0][6]).toBeGreaterThan(nowInSeconds);
  });

  it('accepts a lowercase bearer authorization header (Amplify v6)', async () => {
    const response = await handler(
      { ...BASE_EVENT, path: '/initiate-auth', httpMethod: 'POST', headers: { authorization: `Bearer ${accessToken()}` } },
      BASE_CONTEXT
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).code).toBe('REAUTH_REQUIRED');
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('fails closed with 500 when the challenge cannot be written', async () => {
    createSpy.mockRejectedValue(new Error('dynamodb down'));
    const response = await handler(
      { ...BASE_EVENT, path: '/initiate-auth', httpMethod: 'POST', headers: { Authorization: `Bearer ${accessToken()}` } },
      BASE_CONTEXT
    );
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
