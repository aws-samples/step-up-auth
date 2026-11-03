// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, afterEach } from '@jest/globals';
import { readBoundedIntEnv } from '../lib/env';

const VAR = 'STEP_UP_TEST_BOUNDED';

describe('readBoundedIntEnv', () => {
  afterEach(() => {
    delete process.env[VAR];
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
});
