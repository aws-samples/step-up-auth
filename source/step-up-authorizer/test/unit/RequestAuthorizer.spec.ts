// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { CognitoToken } from '@step-up-auth/auth-utils';
import {
  AuthClaimEnum,
  ReadException,
  RecordNotFoundException,
  Session,
  SessionClient,
  SettingClient,
  StepUpClaimEnum,
  StepUpStatusEnum,
  StepUpStateEnum } from '@step-up-auth/auth-sdk';
import { RequestAuthorizer } from '../../src/RequestAuthorizer';
import * as mocks from '../mocks/mocks';

// unsigned access token: CognitoToken.verify() is mocked, the claims are only decoded
const base64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const nowInSeconds = (): number => Math.floor(Date.now() / 1000);
const TOKEN_EXP = nowInSeconds() + 3600;
const JTI = 'jti-1';
const USERNAME = 'user1';
const CLIENT_ID = 'client-1';
const ACCESS_TOKEN = [
  base64url({ kid: 'test-kid', alg: 'RS256' }),
  base64url({ sub: 'sub-1', token_use: 'access', jti: JTI, username: USERNAME, client_id: CLIENT_ID, exp: TOKEN_EXP, iat: TOKEN_EXP - 3600 }),
  'c2lnbmF0dXJl'
].join('.');

// the authorizer response context is the same for every allow and deny response
const RESPONSE_CONTEXT = {
  [AuthClaimEnum.STEP_UP_CLAIM]: StepUpClaimEnum.STEP_UP_NOT_REQUIRED,
  [AuthClaimEnum.SESSION_ID_CLAIM]: ''
};

const authorizerEvent = (path: string): APIGatewayRequestAuthorizerEvent => {
  const event: APIGatewayRequestAuthorizerEvent = JSON.parse(JSON.stringify(mocks.requestAuthorizerEvent));
  event.path = path;
  event.headers = { ...event.headers, Authorization: `Bearer ${ACCESS_TOKEN}` };
  return event;
};

const session = (stepUpStatus: StepUpStatusEnum, ttl?: number): Session => {
  const s = new Session(JTI, USERNAME, CLIENT_ID, undefined, '/transfer', stepUpStatus);
  (s as { ttl?: number }).ttl = ttl;
  return s;
};

describe('RequestAuthorizer', () => {
  let verifySpy: jest.SpiedFunction<CognitoToken['verify']>;
  let getStepUpStatusSpy: jest.SpiedFunction<SettingClient['getStepUpStatus']>;
  let getSessionSpy: jest.SpiedFunction<SessionClient['getSession']>;
  let createSessionSpy: jest.SpiedFunction<SessionClient['createSessionWithParams']>;
  // every other SessionClient method that reads or writes the session table
  let otherSessionTableSpies: jest.SpiedFunction<(...args: never[]) => unknown>[];

  const generate = (path = '/transfer') =>
    new RequestAuthorizer(authorizerEvent(path), mocks.requestAuthorizerEvent.methodArn).generateResponseForEvent();

  const expectSessionTableUntouched = () => {
    expect(getSessionSpy).not.toHaveBeenCalled();
    expect(createSessionSpy).not.toHaveBeenCalled();
    otherSessionTableSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  };

  const expectNewRequiredSession = () => {
    expect(createSessionSpy).toHaveBeenCalledTimes(1);
    expect(createSessionSpy).toHaveBeenCalledWith(
      JTI, USERNAME, CLIENT_ID, undefined, expect.any(String), StepUpStatusEnum.STEP_UP_REQUIRED, TOKEN_EXP);
  };

  beforeEach(() => {
    verifySpy = jest.spyOn(CognitoToken.prototype, 'verify').mockResolvedValue(true);
    getStepUpStatusSpy = jest.spyOn(SettingClient.prototype, 'getStepUpStatus').mockResolvedValue(StepUpStateEnum.STEP_UP_REQUIRED);
    getSessionSpy = jest.spyOn(SessionClient.prototype, 'getSession')
      .mockRejectedValue(new RecordNotFoundException('unable to locate record'));
    createSessionSpy = jest.spyOn(SessionClient.prototype, 'createSessionWithParams').mockResolvedValue(JTI);
    otherSessionTableSpies = [
      jest.spyOn(SessionClient.prototype, 'createSession').mockResolvedValue(JTI),
      jest.spyOn(SessionClient.prototype, 'updateSession').mockResolvedValue(JTI),
      jest.spyOn(SessionClient.prototype, 'updateStepUpStatus').mockResolvedValue(JTI),
      jest.spyOn(SessionClient.prototype, 'completeStepUpRequest').mockResolvedValue(JTI),
      jest.spyOn(SessionClient.prototype, 'deleteSession').mockResolvedValue(JTI)
    ] as unknown as jest.SpiedFunction<(...args: never[]) => unknown>[];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('STEP_UP_DENY api', () => {
    it('denies (403) even when the caller has a valid STEP_UP_COMPLETED session', async () => {
      getStepUpStatusSpy.mockResolvedValue(StepUpStateEnum.STEP_UP_DENY);
      getSessionSpy.mockResolvedValue(session(StepUpStatusEnum.STEP_UP_COMPLETED, nowInSeconds() + 300));

      const response = await generate();

      expect(getStepUpStatusSpy).toHaveBeenCalledWith('/transfer');
      expect(response.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(response.context).toEqual(RESPONSE_CONTEXT);
      expectSessionTableUntouched();
    });
  });

  describe('api that does not require step-up', () => {
    it('allows a STEP_UP_NOT_REQUIRED api while the token has a pending STEP_UP_REQUIRED session', async () => {
      getStepUpStatusSpy.mockResolvedValue(StepUpStateEnum.STEP_UP_NOT_REQUIRED);
      getSessionSpy.mockResolvedValue(session(StepUpStatusEnum.STEP_UP_REQUIRED, nowInSeconds() + 300));

      const response = await generate('/info');

      expect(getStepUpStatusSpy).toHaveBeenCalledWith('/info');
      expect(response.policyDocument.Statement[0].Effect).toBe('Allow');
      expect(response.context).toEqual(RESPONSE_CONTEXT);
      expectSessionTableUntouched();
    });

    it('allows an api with no setting row without reading or writing the session table', async () => {
      // use the real getStepUpStatus(): a missing setting row maps to STEP_UP_NOT_REQUIRED
      getStepUpStatusSpy.mockRestore();
      const getSettingSpy = jest.spyOn(SettingClient.prototype, 'getSetting')
        .mockRejectedValue(new RecordNotFoundException('unable to locate record with id: /info'));

      const response = await generate('/info');

      expect(getSettingSpy).toHaveBeenCalledWith('/info');
      expect(response.policyDocument.Statement[0].Effect).toBe('Allow');
      expect(response.principalId).toBe(USERNAME);
      expect(response.context).toEqual(RESPONSE_CONTEXT);
      expectSessionTableUntouched();
    });
  });

  describe('STEP_UP_REQUIRED api', () => {
    it('allows a STEP_UP_COMPLETED session whose ttl is in the future', async () => {
      getSessionSpy.mockResolvedValue(session(StepUpStatusEnum.STEP_UP_COMPLETED, nowInSeconds() + 300));

      const response = await generate();

      expect(verifySpy).toHaveBeenCalledWith('access');
      expect(getStepUpStatusSpy).toHaveBeenCalledWith('/transfer');
      expect(getSessionSpy).toHaveBeenCalledWith(JTI);
      expect(response.policyDocument.Statement[0].Effect).toBe('Allow');
      expect(response.principalId).toBe(USERNAME);
      expect(response.context).toEqual(RESPONSE_CONTEXT);
      expect(createSessionSpy).not.toHaveBeenCalled();
    });

    it('rejects an expired STEP_UP_COMPLETED session with 401 and creates a new STEP_UP_REQUIRED session', async () => {
      getSessionSpy.mockResolvedValue(session(StepUpStatusEnum.STEP_UP_COMPLETED, nowInSeconds() - 10));

      await expect(generate()).rejects.toThrow('Unauthorized');

      expect(getStepUpStatusSpy).toHaveBeenCalledWith('/transfer');
      expectNewRequiredSession();
    });

    it('rejects a STEP_UP_COMPLETED session without ttl with 401 and creates a new STEP_UP_REQUIRED session', async () => {
      getSessionSpy.mockResolvedValue(session(StepUpStatusEnum.STEP_UP_COMPLETED, undefined));

      await expect(generate()).rejects.toThrow('Unauthorized');

      expectNewRequiredSession();
    });

    it('rejects with 401 and creates a STEP_UP_REQUIRED session when there is no session', async () => {
      getSessionSpy.mockRejectedValue(new RecordNotFoundException(`unable to locate record with sessionId: ${JTI}`));

      await expect(generate()).rejects.toThrow('Unauthorized');

      expect(getSessionSpy).toHaveBeenCalledWith(JTI);
      expectNewRequiredSession();
    });

    it.each([
      StepUpStatusEnum.STEP_UP_REQUIRED,
      StepUpStatusEnum.STEP_UP_NOT_REQUIRED,
      StepUpStatusEnum.STEP_UP_ERROR
    ])('rejects a %s session with a future ttl with 401 and creates a new STEP_UP_REQUIRED session', async (stepUpStatus) => {
      getSessionSpy.mockResolvedValue(session(stepUpStatus, nowInSeconds() + 300));

      await expect(generate()).rejects.toThrow('Unauthorized');

      expectNewRequiredSession();
    });

    it.each([
      ['ReadException', new ReadException('error while retrieving record - ProvisionedThroughputExceededException: throttled')],
      ['any other error', Object.assign(new Error('not authorized to perform dynamodb:GetItem'), { name: 'AccessDeniedException' })]
    ])('never allows when the session cannot be read (%s): denies (403) without creating a session', async (_name, error) => {
      getSessionSpy.mockRejectedValue(error);

      const response = await generate();

      expect(response.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(response.context).toEqual(RESPONSE_CONTEXT);
      expect(createSessionSpy).not.toHaveBeenCalled();
    });
  });

  describe('setting read error', () => {
    it('denies (403) when the setting cannot be read', async () => {
      // use the real getStepUpStatus(): a read error maps to STEP_UP_DENY (fail closed)
      getStepUpStatusSpy.mockRestore();
      const getSettingSpy = jest.spyOn(SettingClient.prototype, 'getSetting')
        .mockRejectedValue(new ReadException('error while retrieving record with id: /transfer - AccessDeniedException'));
      getSessionSpy.mockResolvedValue(session(StepUpStatusEnum.STEP_UP_COMPLETED, nowInSeconds() + 300));

      const response = await generate();

      expect(getSettingSpy).toHaveBeenCalledWith('/transfer');
      expect(response.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(response.context).toEqual(RESPONSE_CONTEXT);
      expectSessionTableUntouched();
    });

    it('denies (403) when the setting lookup throws', async () => {
      getStepUpStatusSpy.mockRejectedValue(new Error('unexpected error'));
      getSessionSpy.mockResolvedValue(session(StepUpStatusEnum.STEP_UP_COMPLETED, nowInSeconds() + 300));

      const response = await generate();

      expect(response.policyDocument.Statement[0].Effect).toBe('Deny');
      expectSessionTableUntouched();
    });
  });

  it('denies when token verification fails', async () => {
    verifySpy.mockResolvedValue(false);

    const response = await generate();

    expect(response.policyDocument.Statement[0].Effect).toBe('Deny');
    expect(getStepUpStatusSpy).not.toHaveBeenCalled();
    expectSessionTableUntouched();
  });
});
