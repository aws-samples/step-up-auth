// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { readBoundedIntEnv } from '../lib/env';
import { Logger } from '../lib/Logger';

const VAR = 'STEP_UP_TEST_BOUNDED';

describe('readBoundedIntEnv', () => {
  // Jest 30 types an untyped jest.Mock loosely; type warn() to accept mockImplementation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type WarnMock = jest.Mock<(...args: any[]) => any>;
  let warnSpy: WarnMock;

  beforeEach(() => {
    // capture every warning so tests can assert the fallback contract, and keep test output quiet
    warnSpy = (jest.spyOn(Logger.prototype, 'warn') as unknown as WarnMock).mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env[VAR];
    jest.restoreAllMocks();
  });

  it('returns the default when the variable is unset', () => {
    expect(readBoundedIntEnv(VAR, 1, 0, 10)).toBe(1);
  });

  it('returns the default when the variable is empty or whitespace', () => {
    process.env[VAR] = '';
    expect(readBoundedIntEnv(VAR, 1, 0, 10)).toBe(1);
    process.env[VAR] = '   ';
    expect(readBoundedIntEnv(VAR, 1, 0, 10)).toBe(1);
  });

  it('returns a valid in-range whole number, trimming surrounding whitespace', () => {
    process.env[VAR] = '7';
    expect(readBoundedIntEnv(VAR, 1, 0, 10)).toBe(7);
    process.env[VAR] = '  3  ';
    expect(readBoundedIntEnv(VAR, 1, 0, 10)).toBe(3);
  });

  it('accepts the inclusive min and max boundaries', () => {
    process.env[VAR] = '0';
    expect(readBoundedIntEnv(VAR, 5, 0, 10)).toBe(0);
    process.env[VAR] = '10';
    expect(readBoundedIntEnv(VAR, 5, 0, 10)).toBe(10);
  });

  it('falls back to the default when the value is below the range (never widens the window)', () => {
    process.env[VAR] = '29';
    expect(readBoundedIntEnv(VAR, 120, 30, 900)).toBe(120);
  });

  it('falls back to the default when the value is above the range', () => {
    process.env[VAR] = '901';
    expect(readBoundedIntEnv(VAR, 120, 30, 900)).toBe(120);
  });

  it('falls back to the default for a negative value', () => {
    process.env[VAR] = '-5';
    expect(readBoundedIntEnv(VAR, 1, 0, 10)).toBe(1);
  });

  it('falls back to the default for a non-whole-number or non-numeric value', () => {
    for (const bad of ['1.5', 'abc', '10s', '0x5', '1e2']) {
      process.env[VAR] = bad;
      expect(readBoundedIntEnv(VAR, 1, 0, 10)).toBe(1);
    }
  });

  describe('fail-safe warnings (name the variable, never the supplied value)', () => {
    const firstWarning = (): string => String(warnSpy.mock.calls[0][0]);

    it('warns on a missing variable, naming it and the safe default/range', () => {
      expect(readBoundedIntEnv(VAR, 120, 30, 900)).toBe(120);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(firstWarning()).toContain(VAR);
      expect(firstWarning()).toContain('120');
    });

    it('warns on a blank variable, naming it', () => {
      process.env[VAR] = '   ';
      expect(readBoundedIntEnv(VAR, 120, 30, 900)).toBe(120);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(firstWarning()).toContain(VAR);
    });

    it('warns on a malformed value without echoing the supplied value (no secret leak)', () => {
      const secretLike = 's3cr3t-token-not-a-number';
      process.env[VAR] = secretLike;
      expect(readBoundedIntEnv(VAR, 1, 0, 10)).toBe(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(firstWarning()).toContain(VAR);
      expect(firstWarning()).not.toContain(secretLike);
    });

    it('warns on an out-of-range value without echoing the supplied value', () => {
      process.env[VAR] = '99999';
      expect(readBoundedIntEnv(VAR, 120, 30, 900)).toBe(120);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(firstWarning()).toContain(VAR);
      expect(firstWarning()).not.toContain('99999');
    });

    it('does not warn for a valid in-range value', () => {
      process.env[VAR] = '5';
      expect(readBoundedIntEnv(VAR, 1, 0, 10)).toBe(5);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
