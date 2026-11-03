// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Logger } from './Logger';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

/**
 * Read a whole-number configuration value from an environment variable, enforcing an inclusive
 * `[min, max]` range.  This is the one shared way the step-up Lambdas read a numeric tuning parameter
 * (a window, skew, lifetime or max age) so they all behave the same.
 *
 * It fails safe: when the variable is unset/empty, is not a whole number, or falls outside the allowed
 * range, the secure `defaultValue` is returned and a warning that names the variable (never a token or
 * secret) is logged.  A malformed or out-of-range value therefore can NEVER widen a security window —
 * it only ever falls back to the vetted default.
 *
 * @param {string} name environment variable name (e.g. `STEP_UP_CHALLENGE_CLOCK_SKEW`)
 * @param {number} defaultValue secure default to use when the variable is missing or invalid
 * @param {number} min smallest accepted value (inclusive)
 * @param {number} max largest accepted value (inclusive)
 * @returns {number} the parsed value when valid and in range, otherwise `defaultValue`
 */
export function readBoundedIntEnv(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return defaultValue;
  }
  const text = raw.trim();
  if (!/^-?\d+$/.test(text)) {
    log.warn(`${name} is not a whole number ('${text}'); falling back to the secure default ${defaultValue}`);
    return defaultValue;
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    log.warn(`${name} (${text}) is outside the allowed range ${min}-${max}; falling back to the secure default ${defaultValue}`);
    return defaultValue;
  }
  return value;
}
