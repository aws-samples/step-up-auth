// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import {
  CognitoIdentityProviderClient,
  VerifySoftwareTokenCommand } from '@aws-sdk/client-cognito-identity-provider';
import { CognitoToken } from '@step-up-auth/auth-utils';
import { Session, SessionClient, StepUpStatusEnum } from '@step-up-auth/auth-sdk';
import { ChallengeResponder } from '../../src/ChallengeResponder';
import { STChallengeResponder } from '../../src/STChallengeResponder';
import { signJwt, testJwk } from '../helpers/jwt';

const USER_POOL_ID = 'us-east-1_TESTPOOL1';
const USER_POOL_ARN = `arn:aws:cognito-idp:us-east-1:123456789012:userpool/${USER_POOL_ID}`;
const ISSUER = `https://cognito-idp.us-east-1.amazonaws.com/${USER_POOL_ID}`;
const CLIENT_ID = 'testclient';
const JTI = 'jti-1';
const nowInSeconds = (): number => Math.floor(Date.now() / 1000);
const TOKEN_EXP = nowInSeconds() + 3600;

const validToken = (): string => signJwt({
  sub: 'sub-1',
  iss: ISSUER,
  token_use: 'access',
  scope: 'aws.cognito.signin.user.admin',
  auth_time: TOKEN_EXP - 3600,
  exp: TOKEN_EXP,
  iat: TOKEN_EXP - 3600,
  jti: JTI,
  client_id: CLIENT_ID,
  username: 'alice',
});

// exposes the protected validateToken() for testing
class TestChallengeResponder extends ChallengeResponder {
  public async callValidateToken(): Promise<boolean> {
    return this.validateToken();
  }
}

describe('ChallengeResponder (C3, F1)', () => {
  const originalEnv = { ...process.env };
  const cognitoClient = new CognitoIdentityProviderClient({ region: 'us-east-1' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SendMock = jest.Mock<(...args: any[]) => any>;
  let sendMock: SendMock;

  beforeAll(() => {
    // prime the JWKS cache of the verifier that CognitoToken.verify('access') uses (no network call)
    CognitoToken.getVerifier(USER_POOL_ID, 'access', CLIENT_ID).cacheJwks({ keys: [testJwk] });
  });

  beforeEach(() => {
    process.env.COGNITO_USER_POOL_ARN = USER_POOL_ARN;
    process.env.COGNITO_CLIENT_ID = CLIENT_ID;
    sendMock = (jest.spyOn(CognitoIdentityProviderClient.prototype, 'send') as unknown as SendMock)
      .mockResolvedValue({ Status: 'SUCCESS' });
    jest.spyOn(SessionClient.prototype, 'getSession').mockResolvedValue(
      new Session(JTI, 'alice', CLIENT_ID, undefined, '/transfer', StepUpStatusEnum.STEP_UP_REQUIRED));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  describe('validateToken()', () => {
    it('resolves false for a tampered token', async () => {
      const [header, , signature] = validToken().split('.');
      const claims = JSON.parse(Buffer.from(validToken().split('.')[1], 'base64url').toString('utf8'));
      const tamperedPayload = Buffer.from(JSON.stringify({ ...claims, username: 'mallory' })).toString('base64url');
      const responder = new TestChallengeResponder(`${header}.${tamperedPayload}.${signature}`, '123456', cognitoClient);

      await expect(responder.callValidateToken()).resolves.toBe(false);
    });

    it('resolves true for a valid token', async () => {
      const responder = new TestChallengeResponder(validToken(), '123456', cognitoClient);

      await expect(responder.callValidateToken()).resolves.toBe(true);
    });
  });

  describe('validate()', () => {
    it('resolves only after the session update has completed', async () => {
      let sessionWritten = false;
      const updateSpy = jest.spyOn(SessionClient.prototype, 'updateSession').mockImplementation(
        () => new Promise<string>((resolve) => {
          setTimeout(() => {
            sessionWritten = true;
            resolve(JTI);
          }, 50);
        }));

      const result = await new STChallengeResponder(validToken(), '123456', cognitoClient).validate();

      expect(result).toBe(true);
      expect(sessionWritten).toBe(true);
      expect(sendMock.mock.calls[0][0]).toBeInstanceOf(VerifySoftwareTokenCommand);
      expect(updateSpy).toHaveBeenCalledTimes(1);
      const [updatedSession, , tokenExp] = updateSpy.mock.calls[0];
      expect(updatedSession.stepUpStatus).toBe(StepUpStatusEnum.STEP_UP_COMPLETED);
      expect(tokenExp).toBe(TOKEN_EXP);
    });

    it('resolves false when the session update fails', async () => {
      jest.spyOn(SessionClient.prototype, 'updateSession').mockRejectedValue(new Error('ProvisionedThroughputExceededException'));

      await expect(new STChallengeResponder(validToken(), '123456', cognitoClient).validate()).resolves.toBe(false);
    });

    it('resolves false and skips Cognito for a tampered token', async () => {
      const [header, , signature] = validToken().split('.');
      const claims = JSON.parse(Buffer.from(validToken().split('.')[1], 'base64url').toString('utf8'));
      const tamperedPayload = Buffer.from(JSON.stringify({ ...claims, jti: 'other-session' })).toString('base64url');

      await expect(new STChallengeResponder(`${header}.${tamperedPayload}.${signature}`, '123456', cognitoClient).validate()).resolves.toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    });
  });
});
