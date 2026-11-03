// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SessionClient, StepUpStatusEnum } from '../../index';

// SESSION_TABLE_ITEM_TTL governs the step-up session lifetime (the STEP_UP_COMPLETED elevation row and
// the STEP_UP_REQUIRED marker).  Client reads it through the shared fail-safe parser with a bounded
// 60-900 range and a secure 900s default, so a missing, malformed, oversized or out-of-range value can
// never widen the completed-session ttl toward the access token's full remaining lifetime.  These
// tests exercise that boundary end-to-end through a completed-session write.
describe('SESSION_TABLE_ITEM_TTL bounds (completed-session ttl)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SendMock = jest.Mock<(...args: any[]) => any>;
  let sendMock: SendMock;
  const originalEnv = { ...process.env };

  const nowInSeconds = (): number => Math.floor(Date.now() / 1000);
  const putTtl = (): number => {
    const command = sendMock.mock.calls[0][0] as PutItemCommand;
    expect(command).toBeInstanceOf(PutItemCommand);
    return Number(command.input.Item!.ttl.N);
  };

  // a STEP_UP_COMPLETED row written with a far-future token exp, so the ttl reflects
  // SESSION_TABLE_ITEM_TTL rather than the token-expiry cap
  const writeCompleted = async (tokenExp: number): Promise<void> => {
    await new SessionClient().createSessionWithParams(
      'fresh-jti-1', 'alice', 'client-1', undefined, '', StepUpStatusEnum.STEP_UP_COMPLETED, tokenExp);
  };

  beforeEach(() => {
    sendMock = (jest.spyOn(DynamoDBClient.prototype, 'send') as unknown as SendMock).mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('defaults to a 900s window when SESSION_TABLE_ITEM_TTL is missing', async () => {
    delete process.env.SESSION_TABLE_ITEM_TTL;
    const now = nowInSeconds();
    await writeCompleted(now + 100000);
    expect(Math.abs(putTtl() - (now + 900))).toBeLessThanOrEqual(1);
  });

  it('does not widen the completed-session ttl toward the access-token expiry', async () => {
    delete process.env.SESSION_TABLE_ITEM_TTL;
    const now = nowInSeconds();
    const tokenExp = now + 3600; // a 1-hour access token
    await writeCompleted(tokenExp);
    // capped at now + 900, NOT extended to the token's full 3600s expiry
    expect(putTtl()).toBeLessThanOrEqual(now + 901);
    expect(putTtl()).toBeLessThan(tokenExp);
  });

  it('falls back to 900 for a malformed SESSION_TABLE_ITEM_TTL', async () => {
    process.env.SESSION_TABLE_ITEM_TTL = 'abc';
    const now = nowInSeconds();
    await writeCompleted(now + 100000);
    expect(Math.abs(putTtl() - (now + 900))).toBeLessThanOrEqual(1);
  });

  it('falls back to 900 for an oversized SESSION_TABLE_ITEM_TTL (no Infinity widening)', async () => {
    process.env.SESSION_TABLE_ITEM_TTL = '9'.repeat(400);
    const now = nowInSeconds();
    await writeCompleted(now + 100000);
    expect(Math.abs(putTtl() - (now + 900))).toBeLessThanOrEqual(1);
  });

  it('falls back to 900 for a value above the allowed range (901)', async () => {
    process.env.SESSION_TABLE_ITEM_TTL = '901';
    const now = nowInSeconds();
    await writeCompleted(now + 100000);
    expect(Math.abs(putTtl() - (now + 900))).toBeLessThanOrEqual(1);
  });

  it('falls back to 900 for a value below the floor (59)', async () => {
    process.env.SESSION_TABLE_ITEM_TTL = '59';
    const now = nowInSeconds();
    await writeCompleted(now + 100000);
    expect(Math.abs(putTtl() - (now + 900))).toBeLessThanOrEqual(1);
  });

  it('accepts the inclusive boundaries 60 and 900', async () => {
    for (const [value, expected] of [['60', 60], ['900', 900]] as [string, number][]) {
      sendMock.mockClear();
      process.env.SESSION_TABLE_ITEM_TTL = value;
      const now = nowInSeconds();
      await writeCompleted(now + 100000);
      expect(Math.abs(putTtl() - (now + expected))).toBeLessThanOrEqual(1);
    }
  });
});
