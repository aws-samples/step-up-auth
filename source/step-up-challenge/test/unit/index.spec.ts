// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeEach } from '@jest/globals';
import { Context, APIGatewayProxyEvent } from 'aws-lambda';
import {
  CognitoIdentityProviderClient
} from '@aws-sdk/client-cognito-identity-provider';

import { handler } from '../../src/index';

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
    sendMock = (jest.spyOn(
      CognitoIdentityProviderClient.prototype,
      'send'
    ) as jest.Mock).mockClear();
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
