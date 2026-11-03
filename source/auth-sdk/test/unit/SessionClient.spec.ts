// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import {
  DynamoDBClient,
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import {
  SessionClient,
  Session,
  StepUpStatusEnum,
  ReadException,
  RecordNotFoundException } from '../../index';

describe('SessionClient ttl', () => {
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

  describe('createChallengeSession()', () => {
    it('writes the explicit ttl verbatim (challenge creation + STEP_UP_CHALLENGE_TTL)', async () => {
      const now = nowInSeconds();
      const explicitTtl = now + 600;
      await new SessionClient().createChallengeSession('challenge#abc', 'user-1', StepUpStatusEnum.STEP_UP_REQUIRED, explicitTtl);
      expect(putTtl()).toBe(explicitTtl);
    });

    it('is NOT capped by SESSION_TABLE_ITEM_TTL, even when that is set smaller than the challenge ttl', async () => {
      // if the challenge ttl were run through computeTtl, a small SESSION_TABLE_ITEM_TTL would shorten it
      process.env.SESSION_TABLE_ITEM_TTL = '60';
      const now = nowInSeconds();
      const explicitTtl = now + 600;
      await new SessionClient().createChallengeSession('challenge#abc', 'user-1', StepUpStatusEnum.STEP_UP_REQUIRED, explicitTtl);
      // the full 600s ttl is preserved, not clamped to now + 60
      expect(putTtl()).toBe(explicitTtl);
    });

    it('records the challenge subject and a STEP_UP_REQUIRED status', async () => {
      const now = nowInSeconds();
      await new SessionClient().createChallengeSession('challenge#abc', 'sub-1', StepUpStatusEnum.STEP_UP_REQUIRED, now + 600);
      const command = sendMock.mock.calls[0][0] as PutItemCommand;
      expect(command).toBeInstanceOf(PutItemCommand);
      expect(command.input.Item!.sessionId.S).toBe('challenge#abc');
      expect(command.input.Item!.userId.S).toBe('sub-1');
      expect(command.input.Item!.stepUpStatus.S).toBe(StepUpStatusEnum.STEP_UP_REQUIRED);
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

describe('SessionClient getSession()', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SendMock = jest.Mock<(...args: any[]) => any>;
  let sendMock: SendMock;

  beforeEach(() => {
    sendMock = jest.spyOn(DynamoDBClient.prototype, 'send') as unknown as SendMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the session for an existing row', async () => {
    sendMock.mockResolvedValue({
      Item: { sessionId: { S: 'session-1' }, stepUpStatus: { S: 'STEP_UP_COMPLETED' }, ttl: { N: '1700000000' } }
    });
    const retrieved = await new SessionClient().getSession('session-1');
    expect(sendMock.mock.calls[0][0]).toBeInstanceOf(GetItemCommand);
    expect(retrieved.sessionId).toBe('session-1');
    expect(retrieved.stepUpStatus).toBe(StepUpStatusEnum.STEP_UP_COMPLETED);
    expect(retrieved.ttl).toBe(1700000000);
  });

  it('throws RecordNotFoundException for a missing row', async () => {
    sendMock.mockResolvedValue({});
    await expect(new SessionClient().getSession('session-1')).rejects.toBeInstanceOf(RecordNotFoundException);
  });

  it('throws ReadException, not RecordNotFoundException, on a DynamoDB error', async () => {
    sendMock.mockRejectedValue(Object.assign(new Error('not authorized to perform dynamodb:GetItem'), { name: 'AccessDeniedException' }));
    const result = new SessionClient().getSession('session-1');
    await expect(result).rejects.toBeInstanceOf(ReadException);
    await expect(result).rejects.not.toBeInstanceOf(RecordNotFoundException);
  });
});

describe('SessionClient consumeSession()', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SendMock = jest.Mock<(...args: any[]) => any>;
  let sendMock: SendMock;

  beforeEach(() => {
    sendMock = jest.spyOn(DynamoDBClient.prototype, 'send') as unknown as SendMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('issues a single conditional DeleteItem (attribute_exists) and no prior read', async () => {
    sendMock.mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    const id = await new SessionClient().consumeSession('challenge#abc');
    expect(id).toBe('challenge#abc');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as DeleteItemCommand;
    expect(command).toBeInstanceOf(DeleteItemCommand);
    expect(command.input.ConditionExpression).toBe('attribute_exists(sessionId)');
    expect(command.input.Key!.sessionId.S).toBe('challenge#abc');
  });

  it('throws RecordNotFoundException when the conditional delete fails (already consumed)', async () => {
    sendMock.mockRejectedValue(Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' }));
    await expect(new SessionClient().consumeSession('challenge#abc')).rejects.toBeInstanceOf(RecordNotFoundException);
  });

  it('lets exactly one of two concurrent consumers win', async () => {
    // DynamoDB serialises writes to the item: the first conditional delete succeeds, the second finds
    // the row gone and fails its attribute_exists condition
    sendMock
      .mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 } })
      .mockRejectedValue(Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' }));

    const [first, second] = await Promise.allSettled([
      new SessionClient().consumeSession('challenge#abc'),
      new SessionClient().consumeSession('challenge#abc'),
    ]);

    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
  });
});
