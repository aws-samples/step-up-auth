// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { Context, APIGatewayProxyEvent } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  GetUserCommand,
  GetUserAttributeVerificationCodeCommand,
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
  functionName: 'step-up-auth-initiate-lambda',
  functionVersion: '$LATEST',
  invokedFunctionArn:
    'arn:aws:lambda:us-east-1:111111111111:function:step-up-auth-initiate-lambda',
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
        { ...BASE_EVENT, path: '/initiate-auth', httpMethod: 'OPTIONS' },
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
            path: '/initiate-auth',
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

  for (const [
    description,
    preferredMfaSetting,
    userMfaSettingList,
    userAttributes,
  ] of [
    [
      'has no preferred MFA setting and no software token',
      undefined,
      ['SMS_MFA'],
      undefined,
    ],
    [
      'prefers SMS MFA',
      'SMS_MFA',
      ['SMS_MFA', 'SOFTWARE_TOKEN_MFA'],
      undefined,
    ],
    [
      'has no MFA set up and a verified phone number',
      undefined,
      undefined,
      [
        {
          Name: 'phone_number_verified',
          Value: 'true',
        },
        {
          Name: 'phone_number',
          Value: '+11234567890',
        },
      ],
    ],
  ]) {
    it(
      'calls GetUserAttributeVerificationCode and returns SMS_STEP_UP when ' +
        'the user ' +
        description,
      async () => {
        sendMock
          .mockResolvedValueOnce({
            PreferredMfaSetting: preferredMfaSetting,
            UserMFASettingList: userMfaSettingList,
            UserAttributes: userAttributes,
          })
          .mockResolvedValueOnce({});

        expect(
          await handler(
            {
              ...BASE_EVENT,
              path: '/initiate-auth',
              httpMethod: 'POST',
              headers: { Authorization: 'Bearer xyz' },
            },
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
          body: '{"code":"SMS_STEP_UP"}',
        });

        expect(sendMock.mock.calls[0][0]).toBeInstanceOf(GetUserCommand);
        expect(sendMock.mock.calls[0][0].input.AccessToken).toEqual('xyz');

        expect(sendMock.mock.calls[1][0]).toBeInstanceOf(
          GetUserAttributeVerificationCodeCommand
        );
        expect(sendMock.mock.calls[1][0].input.AccessToken).toEqual('xyz');
        expect(sendMock.mock.calls[1][0].input.AttributeName).toEqual(
          'phone_number'
        );

        expect(sendMock).toHaveBeenCalledTimes(2);
      }
    );
  }

  for (const [
    description,
    preferredMfaSetting,
    userMfaSettingList,
    userAttributes,
  ] of [
    [
      'has no preferred MFA setting and a software token',
      undefined,
      ['SMS_MFA', 'SOFTWARE_TOKEN_MFA'],
      undefined,
    ],
    [
      'prefers SOFTWARE_TOKEN_MFA',
      'SOFTWARE_TOKEN_MFA',
      ['SMS_MFA', 'SOFTWARE_TOKEN_MFA'],
      undefined,
    ]
  ]) {
    it(
      'returns SOFTWARE_TOKEN_STEP_UP when the user ' + description,
      async () => {
        sendMock.mockResolvedValueOnce({
          PreferredMfaSetting: preferredMfaSetting,
          UserMFASettingList: userMfaSettingList,
          UserAttributes: userAttributes,
        });

        expect(
          await handler(
            {
              ...BASE_EVENT,
              path: '/initiate-auth',
              httpMethod: 'POST',
              headers: { Authorization: 'Bearer xyz' },
            },
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
          body: '{"code":"SOFTWARE_TOKEN_STEP_UP"}',
        });

        expect(sendMock.mock.calls[0][0]).toBeInstanceOf(GetUserCommand);
        expect(sendMock.mock.calls[0][0].input.AccessToken).toEqual('xyz');
        expect(sendMock).toHaveBeenCalledTimes(1);
      }
    );
  }

  for (const [
    description,
    preferredMfaSetting,
    userMfaSettingList,
    userAttributes,
  ] of [
    [
      'has no MFA set up and an unverified phone number',
      undefined,
      undefined,
      [
        {
          Name: 'phone_number_verified',
          Value: 'false',
        },
        {
          Name: 'phone_number',
          Value: '+11234567890',
        },
      ],
    ],
    ['has no MFA set up and no phone number', undefined, undefined, []],
  ]) {
    it(
      'returns MAYBE_SOFTWARE_TOKEN_STEP_UP when the user ' + description,
      async () => {
        sendMock.mockResolvedValueOnce({
          PreferredMfaSetting: preferredMfaSetting,
          UserMFASettingList: userMfaSettingList,
          UserAttributes: userAttributes,
        });

        expect(
          await handler(
            {
              ...BASE_EVENT,
              path: '/initiate-auth',
              httpMethod: 'POST',
              headers: { Authorization: 'Bearer xyz' },
            },
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
          body: '{"code":"MAYBE_SOFTWARE_TOKEN_STEP_UP"}',
        });

        expect(sendMock.mock.calls[0][0]).toBeInstanceOf(GetUserCommand);
        expect(sendMock.mock.calls[0][0].input.AccessToken).toEqual('xyz');
        expect(sendMock).toHaveBeenCalledTimes(1);
      }
    );
  }

  it('returns NOT_FOUND on any other path', async () => {
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
      statusCode: 404,
      body: '{"code":"NOT_FOUND"}',
      headers: {
        "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,identification,X-Api-Key,X-Amz-Security-Token",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
        "Access-Control-Allow-Origin": "*",
        }
    });
  });
});
