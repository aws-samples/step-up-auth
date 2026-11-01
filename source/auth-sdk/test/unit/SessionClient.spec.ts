// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SessionClient, Session, StepUpStatusEnum } from '../../index';

describe('SessionClient ttl (C2b)', () => {
  const SESSION_TTL = 900;
  const originalEnv = { ...process.env };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SendMock = jest.Mock<(...args: any[]) => any>;
  let sendMock: SendMock;

  const nowInSeconds = (): number => Math.floor(Date.now() / 1000);

  // ttl written by the last PutItem call
  const putTtl = (): number => {
    const command = sendMock.mock.calls[0][0] as PutItemCommand;
    expect(command).toBeInstanceOf(PutItemCommand);
    return Number(command.input.Item!.ttl.N);
  };

  // ttl written by the last UpdateItem call
  const updateTtl = (): number => {
    const command = sendMock.mock.calls[0][0] as UpdateItemCommand;
    expect(command).toBeInstanceOf(UpdateItemCommand);
    return Number(command.input.ExpressionAttributeValues![':ttl'].N);
  };

  const session = (): Session => new Session('session-1', 'user-1', 'client-1', undefined, '/transfer', StepUpStatusEnum.STEP_UP_COMPLETED);

  beforeEach(() => {
    process.env.SESSION_TABLE_ITEM_TTL = `${SESSION_TTL}`;
    sendMock = (jest.spyOn(DynamoDBClient.prototype, 'send') as unknown as SendMock).mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  describe('createSessionWithParams()', () => {
    it('caps ttl at the token exp when the token expires first', async () => {
      const tokenExp = nowInSeconds() + 120;
      await new SessionClient().createSessionWithParams('session-1', 'user-1', 'client-1', undefined, '/transfer', StepUpStatusEnum.STEP_UP_REQUIRED, tokenExp);
      expect(putTtl()).toBe(tokenExp);
    });

    it('uses now + SESSION_TABLE_ITEM_TTL when the token expires later', async () => {
      const now = nowInSeconds();
      await new SessionClient().createSessionWithParams('session-1', 'user-1', 'client-1', undefined, '/transfer', StepUpStatusEnum.STEP_UP_REQUIRED, now + 100000);
      expect(Math.abs(putTtl() - (now + SESSION_TTL))).toBeLessThanOrEqual(1);
    });

    it('uses now + SESSION_TABLE_ITEM_TTL without a token exp', async () => {
      const now = nowInSeconds();
      await new SessionClient().createSessionWithParams('session-1', 'user-1', 'client-1', undefined, '/transfer', StepUpStatusEnum.STEP_UP_REQUIRED);
      expect(Math.abs(putTtl() - (now + SESSION_TTL))).toBeLessThanOrEqual(1);
    });
  });

  describe('updateSession()', () => {
    it('caps ttl at the token exp when the token expires first', async () => {
      const tokenExp = nowInSeconds() + 120;
      await new SessionClient().updateSession(session(), new Date().toISOString(), tokenExp);
      expect(updateTtl()).toBe(tokenExp);
    });

    it('uses lastUpdateTimestamp + SESSION_TABLE_ITEM_TTL when the token expires later', async () => {
      const now = nowInSeconds();
      await new SessionClient().updateSession(session(), new Date().toISOString(), now + 100000);
      expect(Math.abs(updateTtl() - (now + SESSION_TTL))).toBeLessThanOrEqual(1);
    });

    it('uses now + SESSION_TABLE_ITEM_TTL without a token exp', async () => {
      const now = nowInSeconds();
      await new SessionClient().updateSession(session());
      expect(Math.abs(updateTtl() - (now + SESSION_TTL))).toBeLessThanOrEqual(1);
    });
  });
});
