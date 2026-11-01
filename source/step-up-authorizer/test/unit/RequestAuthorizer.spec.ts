// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { CognitoToken } from '@step-up-auth/auth-utils';
import {
  Session,
  SessionClient,
  SettingClient,
  StepUpStatusEnum,
  StepUpStateEnum } from '@step-up-auth/auth-sdk';
import { RequestAuthorizer } from '../../src/RequestAuthorizer';
import * as mocks from '../mocks/mocks';

// unsigned access token: CognitoToken.verify() is mocked, the claims are only decoded
const base64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const nowInSeconds = (): number => Math.floor(Date.now() / 1000);
const TOKEN_EXP = nowInSeconds() + 3600;
const JTI = 'jti-1';
const USERNAME = 'alice';
const CLIENT_ID = 'client-1';
const ACCESS_TOKEN = [
  base64url({ kid: 'test-kid', alg: 'RS256' }),
  base64url({ sub: 'sub-1', token_use: 'access', jti: JTI, username: USERNAME, client_id: CLIENT_ID, exp: TOKEN_EXP, iat: TOKEN_EXP - 3600 }),
  'c2lnbmF0dXJl'
].join('.');

const authorizerEvent = (): APIGatewayRequestAuthorizerEvent => {
  const event: APIGatewayRequestAuthorizerEvent = JSON.parse(JSON.stringify(mocks.requestAuthorizerEvent));
  event.path = '/transfer';
  event.headers = { ...event.headers, Authorization: `Bearer ${ACCESS_TOKEN}` };
  return event;
};

const session = (stepUpStatus: StepUpStatusEnum, ttl?: number): Session => {
  const s = new Session(JTI, USERNAME, CLIENT_ID, undefined, '/transfer', stepUpStatus);
  (s as { ttl?: number }).ttl = ttl;
  return s;
};

describe('RequestAuthorizer session ttl enforcement', () => {
  let verifySpy: jest.SpiedFunction<CognitoToken['verify']>;
  let getSessionSpy: jest.SpiedFunction<SessionClient['getSession']>;
  let createSessionSpy: jest.SpiedFunction<SessionClient['createSessionWithParams']>;
  let getStepUpStatusSpy: jest.SpiedFunction<SettingClient['getStepUpStatus']>;

  const generate = () => new RequestAuthorizer(authorizerEvent(), mocks.requestAuthorizerEvent.methodArn).generateResponseForEvent();

  beforeEach(() => {
    verifySpy = jest.spyOn(CognitoToken.prototype, 'verify').mockResolvedValue(true);
    getSessionSpy = jest.spyOn(SessionClient.prototype, 'getSession');
    createSessionSpy = jest.spyOn(SessionClient.prototype, 'createSessionWithParams').mockResolvedValue(JTI);
    getStepUpStatusSpy = jest.spyOn(SettingClient.prototype, 'getStepUpStatus').mockResolvedValue(StepUpStateEnum.STEP_UP_REQUIRED);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects an expired STEP_UP_COMPLETED session with 401 and re-creates a STEP_UP_REQUIRED session', async () => {
    getSessionSpy.mockResolvedValue(session(StepUpStatusEnum.STEP_UP_COMPLETED, nowInSeconds() - 10));

    await expect(generate()).rejects.toThrow('Unauthorized');

    expect(verifySpy).toHaveBeenCalledWith('access');
    expect(getStepUpStatusSpy).toHaveBeenCalledWith('/transfer');
    expect(createSessionSpy).toHaveBeenCalledTimes(1);
    expect(createSessionSpy).toHaveBeenCalledWith(
      JTI, USERNAME, CLIENT_ID, undefined, expect.any(String), StepUpStatusEnum.STEP_UP_REQUIRED, TOKEN_EXP);
  });

  it('rejects a STEP_UP_COMPLETED session without ttl with 401', async () => {
    getSessionSpy.mockResolvedValue(session(StepUpStatusEnum.STEP_UP_COMPLETED, undefined));

    await expect(generate()).rejects.toThrow('Unauthorized');
    expect(createSessionSpy).toHaveBeenCalledTimes(1);
  });

  it('allows a STEP_UP_COMPLETED session that has not expired', async () => {
    getSessionSpy.mockResolvedValue(session(StepUpStatusEnum.STEP_UP_COMPLETED, nowInSeconds() + 300));

    const response = await generate();

    expect(response.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(getStepUpStatusSpy).not.toHaveBeenCalled();
    expect(createSessionSpy).not.toHaveBeenCalled();
  });

  it('falls through to the setting check for an expired STEP_UP_NOT_REQUIRED session', async () => {
    getSessionSpy.mockResolvedValue(session(StepUpStatusEnum.STEP_UP_NOT_REQUIRED, nowInSeconds() - 10));
    getStepUpStatusSpy.mockResolvedValue(StepUpStateEnum.STEP_UP_NOT_REQUIRED);

    const response = await generate();

    expect(getStepUpStatusSpy).toHaveBeenCalledWith('/transfer');
    expect(response.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(createSessionSpy).not.toHaveBeenCalled();
  });

  it('denies when token verification fails', async () => {
    verifySpy.mockResolvedValue(false);

    const response = await generate();

    expect(response.policyDocument.Statement[0].Effect).toBe('Deny');
    expect(getSessionSpy).not.toHaveBeenCalled();
  });
});
