// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { CreateException, Session, SessionClient, StepUpStatusEnum } from '../../index';
import { generateSessionId } from '../../lib/dynamodb/model/Session';

const nowInSeconds = (): number => Math.floor(Date.now() / 1000);

describe('generated session ids', () => {
  it('are 128-bit random hex strings', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = new Session().sessionId;
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(100);
  });

  it('reject fewer than 16 random bytes, including 0', () => {
    for (const bad of [0, -1, 8, 15, 1.5, Number.NaN]) {
      expect(() => generateSessionId(bad)).toThrow(RangeError);
    }
    expect(generateSessionId(32)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keep an explicit session id', () => {
    expect(new Session('jti-1').sessionId).toBe('jti-1');
  });
});

describe('Session default ttl', () => {
  it('is at most 15 minutes away', () => {
    const before = nowInSeconds();
    const ttl = new Session().ttl;
    expect(ttl).toBeGreaterThanOrEqual(before + 900);
    expect(ttl).toBeLessThanOrEqual(nowInSeconds() + 900);
  });
});

describe('SessionClient.createSession() ttl guard', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SendMock = jest.Mock<(...args: any[]) => any>;
  let sendMock: SendMock;

  beforeEach(() => {
    sendMock = (jest.spyOn(DynamoDBClient.prototype, 'send') as unknown as SendMock).mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const session = (ttl: number): Session => {
    const s = new Session('session-1', 'user-1', 'client-1', undefined, '/transfer', StepUpStatusEnum.STEP_UP_REQUIRED);
    s.ttl = ttl;
    return s;
  };

  it('writes a session with the default ttl', async () => {
    await expect(new SessionClient().createSession(new Session())).resolves.toMatch(/^[0-9a-f]{32}$/);
    expect(sendMock.mock.calls[0][0]).toBeInstanceOf(PutItemCommand);
  });

  it.each([
    ['a year away', nowInSeconds() + 31104000],
    ['16 minutes away', nowInSeconds() + 960],
    ['in the past', nowInSeconds() - 1],
    ['not a number', Number.NaN],
  ])('refuses a ttl %s without calling DynamoDB', async (_name, ttl) => {
    await expect(new SessionClient().createSession(session(ttl))).rejects.toBeInstanceOf(CreateException);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('refuses a session without a session id', async () => {
    const s = session(nowInSeconds() + 60);
    s.sessionId = '';
    await expect(new SessionClient().createSession(s)).rejects.toBeInstanceOf(CreateException);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
