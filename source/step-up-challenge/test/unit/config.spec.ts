// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { Logger } from '@step-up-auth/auth-utils';

import { configuredUserPoolId } from '../../src/config';

const USER_POOL_ID = 'us-east-1_TESTPOOL1';
const USER_POOL_ARN = `arn:aws:cognito-idp:us-east-1:123456789012:userpool/${USER_POOL_ID}`;

describe('configuredUserPoolId()', () => {
  // Jest 30 types an untyped jest.Mock loosely; type warn() to accept mockImplementation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type WarnMock = jest.Mock<(...args: any[]) => any>;
  let warnSpy: WarnMock;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    warnSpy = (jest.spyOn(Logger.prototype, 'warn') as unknown as WarnMock).mockImplementation(() => undefined);
    process.env.USER_POOL_ID = USER_POOL_ID;
    process.env.COGNITO_USER_POOL_ARN = USER_POOL_ARN;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('returns USER_POOL_ID when it is a valid pool id that matches COGNITO_USER_POOL_ARN', () => {
    expect(configuredUserPoolId()).toBe(USER_POOL_ID);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns a valid USER_POOL_ID when COGNITO_USER_POOL_ARN is not set', () => {
    delete process.env.COGNITO_USER_POOL_ARN;
    expect(configuredUserPoolId()).toBe(USER_POOL_ID);
  });

  it('returns undefined when USER_POOL_ID is unset or empty', () => {
    delete process.env.USER_POOL_ID;
    expect(configuredUserPoolId()).toBeUndefined();
    process.env.USER_POOL_ID = '';
    expect(configuredUserPoolId()).toBeUndefined();
  });

  it.each([
    'us-east-1',
    'TESTPOOL1',
    'US-EAST-1_TESTPOOL1',
    'us-east-1_',
    'us-east-1_TEST POOL1',
    ' us-east-1_TESTPOOL1',
    'us-east-1_TESTPOOL1/x',
    USER_POOL_ARN,
  ])('returns undefined for the malformed value %p', (value) => {
    process.env.USER_POOL_ID = value;
    expect(configuredUserPoolId()).toBeUndefined();
  });

  it('returns undefined when USER_POOL_ID names a different pool from COGNITO_USER_POOL_ARN', () => {
    process.env.USER_POOL_ID = 'us-east-1_OTHERPOOL';
    expect(configuredUserPoolId()).toBeUndefined();
  });

  it('warns naming the variable, without echoing the supplied value', () => {
    const secretLike = 's3cr3t-token-not-a-pool-id';
    process.env.USER_POOL_ID = secretLike;
    expect(configuredUserPoolId()).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('USER_POOL_ID');
    expect(String(warnSpy.mock.calls[0][0])).not.toContain(secretLike);

    warnSpy.mockClear();
    process.env.USER_POOL_ID = 'us-east-1_OTHERPOOL';
    expect(configuredUserPoolId()).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('USER_POOL_ID');
    expect(String(warnSpy.mock.calls[0][0])).not.toContain('OTHERPOOL');
  });
});
