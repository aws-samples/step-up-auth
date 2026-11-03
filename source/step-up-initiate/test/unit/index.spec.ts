// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from '@jest/globals';
import { Context, APIGatewayProxyEvent } from 'aws-lambda';

import { handler } from '../../src/index';

const HEADERS = {
  'Access-Control-Allow-Headers':
    'Content-Type,X-Amz-Date,Authorization,identification,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
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
    });
  }

  it('returns REAUTH_REQUIRED for a bearer access token', async () => {
    expect(
      await handler(
        { ...BASE_EVENT, path: '/initiate-auth', httpMethod: 'POST', headers: { Authorization: 'Bearer xyz' } },
        BASE_CONTEXT
      )
    ).toEqual({ statusCode: 200, headers: HEADERS, body: '{"code":"REAUTH_REQUIRED"}' });
  });

  it('accepts a lowercase bearer authorization header (Amplify v6)', async () => {
    const response = await handler(
      { ...BASE_EVENT, path: '/initiate-auth', httpMethod: 'POST', headers: { authorization: 'Bearer xyz' } },
      BASE_CONTEXT
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"code":"REAUTH_REQUIRED"}');
  });

  it('returns NOT_FOUND on any other path', async () => {
    expect(
      await handler(
        { ...BASE_EVENT, path: '/some-path', httpMethod: 'GET', headers: { Authorization: 'Bearer xyz' } },
        BASE_CONTEXT
      )
    ).toEqual({ statusCode: 404, headers: HEADERS, body: '{"code":"NOT_FOUND"}' });
  });
});
