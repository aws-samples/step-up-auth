// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { Context, APIGatewayProxyEvent } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  VerifySoftwareTokenCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoToken } from '@step-up-auth/auth-utils';
import { Session, SessionClient, StepUpStatusEnum } from '@step-up-auth/auth-sdk';

import { handler } from '../../src/index';
import { signJwt, testJwk } from '../helpers/jwt';

const BASE_EVENT: APIGatewayProxyEvent = {
  body: '',
  headers: {},
  multiValueHeaders: {},
  httpMethod: 'GET',
  isBase64Encoded: false,
  path: '/',
  pathParameters: {},
  queryStringParameters: {},
  multiValueQueryStringParameters: {},
  stageVariables: {},
  requestContext: {} as any,
  resource: '',
};
const BASE_CONTEXT: Context = {
  callbackWaitsForEmptyEventLoop: true,
  functionName: 'step-up-auth-challenge-lambda',
  functionVersion: '$LATEST',
  invokedFunctionArn:
    'arn:aws:lambda:us-east-1:111111111111:function:step-up-auth-challenge-lambda',
  memoryLimitInMB: '128MB',
  awsRequestId: '2779be16-fc84-4d32-81f9-0ce97a21dff1',
  logGroupName: '/log/group/path',
  logStreamName: '/log/stream/path',
  getRemainingTimeInMillis: {} as any,
  done: {} as any,
  fail: {} as any,
  succeed: {} as any,
};

describe('handler', () => {
  let sendMock: jest.Mock;

  beforeEach(() => {
    sendMock = (
      (jest.spyOn(
      CognitoIdentityProviderClient.prototype,
      'send'
      ) as unknown) as jest.Mock).mockClear();
  });

  it('returns the correct OPTIONS response', async () => {
    expect(
      await handler(
        { ...BASE_EVENT, path: '/respond-to-challenge', httpMethod: 'OPTIONS' },
        BASE_CONTEXT
      )
    ).toEqual({
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Headers':
          'Content-Type,X-Amz-Date,Authorization,identification,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
      },
      body: '{}',
    });
  });

  for (const [description, value] of [
    ['no authorization header', undefined],
    ['a non-bearer authorization header', 'Basic zzzz'],
    ['an invalid access token', 'Bearer #*!'],
  ]) {
    it('returns UNAUTHENTICATED when passed ' + description, async () => {
      expect(
        await handler(
          {
            ...BASE_EVENT,
            path: '/respond-to-challenge',
            httpMethod: 'POST',
            headers: { Authorization: value },
          },
          BASE_CONTEXT
        )
      ).toEqual({
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Headers':
            'Content-Type,X-Amz-Date,Authorization,identification,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
        },
        body: '{"code":"UNAUTHENTICATED"}',
      });
    });
  }

  it('returns UNAUTHENTICATED when passed a lowercase non-bearer authorization header', async () => {
    const response = await handler(
      {
        ...BASE_EVENT,
        path: '/respond-to-challenge',
        httpMethod: 'POST',
        headers: { authorization: 'Basic zzzz' },
      },
      BASE_CONTEXT
    );
    expect(response.statusCode).toBe(401);
    expect(response.body).toBe('{"code":"UNAUTHENTICATED"}');
  });

  describe('with a lowercase authorization header (Amplify v6)', () => {
    const USER_POOL_ID = 'us-east-1_TESTPOOL1';
    const CLIENT_ID = 'testclient';
    const originalEnv = { ...process.env };

    beforeAll(() => {
      // prime the JWKS cache of the verifier that CognitoToken.verify('access') uses (no network call)
      CognitoToken.getVerifier(USER_POOL_ID, 'access', CLIENT_ID).cacheJwks({ keys: [testJwk] });
    });

    beforeEach(() => {
      process.env.COGNITO_USER_POOL_ARN = `arn:aws:cognito-idp:us-east-1:123456789012:userpool/${USER_POOL_ID}`;
      process.env.COGNITO_CLIENT_ID = CLIENT_ID;
      jest.spyOn(SessionClient.prototype, 'getSession').mockResolvedValue(
        new Session('jti-1', 'alice', CLIENT_ID, undefined, '/transfer', StepUpStatusEnum.STEP_UP_REQUIRED));
      jest.spyOn(SessionClient.prototype, 'updateSession').mockResolvedValue('jti-1');
    });

    afterEach(() => {
      jest.restoreAllMocks();
      process.env = { ...originalEnv };
    });

    it('accepts the bearer token and verifies the challenge with Cognito', async () => {
      const now = Math.floor(Date.now() / 1000);
      const accessToken = signJwt({
        sub: 'sub-1', iss: `https://cognito-idp.us-east-1.amazonaws.com/${USER_POOL_ID}`, token_use: 'access',
        exp: now + 3600, iat: now, jti: 'jti-1', client_id: CLIENT_ID, username: 'alice',
      });
      sendMock.mockResolvedValue({ Status: 'SUCCESS' });

      const response = await handler(
        {
          ...BASE_EVENT,
          path: '/respond-to-challenge',
          httpMethod: 'POST',
          headers: { authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ 'step-up-type': 'SOFTWARE_TOKEN_STEP_UP', 'challenge-response': '123456' }),
        },
        BASE_CONTEXT
      );

      expect(response.statusCode).toBe(200);
      expect(sendMock.mock.calls[0][0]).toBeInstanceOf(VerifySoftwareTokenCommand);
      expect(sendMock.mock.calls[0][0].input.AccessToken).toBe(accessToken);
    });
  });

  it('returns 400 on any other path', async () => {
    expect(
      await handler(
        {
          ...BASE_EVENT,
          path: '/some-path',
          httpMethod: 'GET',
          headers: { Authorization: 'Bearer xyz' },
        },
        BASE_CONTEXT
      )
    ).toEqual({
      statusCode: 400,
      body: '{"code":1,"message":"unhandled request","type":"request","caused":"handler"}',
      headers: {
        "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,identification,X-Api-Key,X-Amz-Security-Token",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
        "Access-Control-Allow-Origin": "*",
        }
    });
  });
});
