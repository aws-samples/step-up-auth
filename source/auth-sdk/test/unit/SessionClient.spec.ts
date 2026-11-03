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
    // creation epoch stored on the written row: floor(Date.parse(createTimestamp) / 1000)
    const putCreateEpoch = (): number => {
      const command = sendMock.mock.calls[0][0] as PutItemCommand;
      expect(command).toBeInstanceOf(PutItemCommand);
      return Math.floor(Date.parse(command.input.Item!.createTimestamp.S!) / 1000);
    };

    it('derives the ttl from the stored creation timestamp (creation epoch + lifetime)', async () => {
      const lifetime = 600;
      await new SessionClient().createChallengeSession('challenge#abc', 'user-1', StepUpStatusEnum.STEP_UP_REQUIRED, lifetime);
      expect(putTtl()).toBe(putCreateEpoch() + lifetime);
    });

    it('keeps ttl === floor(createTimestamp) + lifetime across a sub-second boundary (single clock read)', async () => {
      // freeze the clock 1ms before a second rollover: two independent reads could land on different
      // seconds, but deriving both fields from one read keeps createTimestamp and ttl exactly consistent
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.999Z'));
      try {
        const lifetime = 300;
        await new SessionClient().createChallengeSession('challenge#edge', 'user-1', StepUpStatusEnum.STEP_UP_REQUIRED, lifetime);
        const createEpoch = putCreateEpoch();
        expect(createEpoch).toBe(Math.floor(Date.parse('2026-01-01T00:00:00.999Z') / 1000));
        expect(putTtl()).toBe(createEpoch + lifetime);
      } finally {
        jest.useRealTimers();
      }
    });

    it('is NOT shortened by a smaller SESSION_TABLE_ITEM_TTL (bypasses the computeTtl cap)', async () => {
      // if the challenge ran through computeTtl, a 60s SESSION_TABLE_ITEM_TTL would clamp a 600s challenge
      process.env.SESSION_TABLE_ITEM_TTL = '60';
      const lifetime = 600;
      await new SessionClient().createChallengeSession('challenge#abc', 'user-1', StepUpStatusEnum.STEP_UP_REQUIRED, lifetime);
      // the full lifetime is preserved relative to the stored creation epoch, not clamped to now + 60
      expect(putTtl()).toBe(putCreateEpoch() + lifetime);
    });

    it('records the challenge subject and a STEP_UP_REQUIRED status', async () => {
      await new SessionClient().createChallengeSession('challenge#abc', 'sub-1', StepUpStatusEnum.STEP_UP_REQUIRED, 600);
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
