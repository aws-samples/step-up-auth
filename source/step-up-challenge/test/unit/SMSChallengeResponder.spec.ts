// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from '@jest/globals';
import { Context, APIGatewayProxyEvent } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

import { SMSChallengeResponder } from '../../src/SMSChallengeResponder';

describe('SMSChallengeResponder.validate()', () => {
  let sendMock: jest.Mock;

  beforeEach(() => {
    sendMock = (jest.spyOn(
      CognitoIdentityProviderClient.prototype,
      'send'
    ) as jest.Mock).mockClear();
  });

  for (const [
    description,
    accessToken,
    challengeResponse
  ] of [
    [
      'has an incorrect length for the challenge response',
      "Bearer xyz",
      "11"
    ]
  ]) {
    it(
      ' returns false when the user ' + description,
      async () => {
        const client = new CognitoIdentityProviderClient({
          region: process.env.AWS_REGION ? process.env.AWS_REGION : 'us-east-1',
        });
        const smsChallengeResponder = new SMSChallengeResponder(accessToken, challengeResponse, client);
        const promise = smsChallengeResponder.validate();
        await expect(promise).resolves.toEqual( false );
      }
    );
  }

  for (const [
    description,
    accessToken,
    challengeResponse
  ] of [
    [
      'has an invalid access Token',
      "Bearer xyz",
      "111111"
    ]
  ]) {
    it(
      ' throws an Error when the user ' + description,
      async () => {
        const client = new CognitoIdentityProviderClient({
          region: process.env.AWS_REGION ? process.env.AWS_REGION : 'us-east-1',
        });
        const smsChallengeResponder = new SMSChallengeResponder(accessToken, challengeResponse, client);
        const promise = smsChallengeResponder.validate();
        await expect(promise).rejects.toThrow('invalid token');
      }
    );
  }

});
