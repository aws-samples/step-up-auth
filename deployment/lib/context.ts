// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/** Default step-up session lifetime in seconds (15 minutes). */
export const DEFAULT_SESSION_TABLE_ITEM_TTL = 900;

/** Default maximum age, in seconds, of the re-authentication that step-up will accept (2 minutes). */
export const DEFAULT_STEP_UP_MAX_REAUTH_AGE = 120;
/** Inclusive range for `step_up_max_reauth_age` (seconds). */
export const MIN_STEP_UP_MAX_REAUTH_AGE = 30;
export const MAX_STEP_UP_MAX_REAUTH_AGE = 900;

/** Default lifetime, in seconds, of a one-time step-up challenge (10 minutes). */
export const DEFAULT_STEP_UP_CHALLENGE_TTL = 600;
/** Inclusive range for `step_up_challenge_ttl` (seconds). */
export const MIN_STEP_UP_CHALLENGE_TTL = 60;
export const MAX_STEP_UP_CHALLENGE_TTL = 900;

/** Default clock-skew allowance, in seconds, for the challenge "authenticated after" check. */
export const DEFAULT_STEP_UP_CHALLENGE_CLOCK_SKEW = 1;
/** Default clock-skew allowance, in seconds, for the future-dated `auth_time` guard. */
export const DEFAULT_STEP_UP_REAUTH_FUTURE_SKEW = 5;
/** Inclusive range shared by both step-up clock-skew allowances (seconds). */
export const MIN_STEP_UP_SKEW = 0;
export const MAX_STEP_UP_SKEW = 10;

/**
 * Parse a CDK context value as a whole number within an inclusive `[min, max]` range (seconds).
 * Returns `defaultValue` when the value is not set, and throws when it is not a whole number or is out
 * of range.  This is the shared basis for the step-up timing parsers below, so the CDK boundary rejects
 * exactly the values the Lambda-side parser (`readBoundedIntEnv`) would fall back on, keeping the two in
 * step.  Values are validated at deploy time (throw) rather than silently defaulted.
 */
function parseBoundedSeconds(key: string, value: unknown, defaultValue: number, min: number, max: number): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const text = String(value).trim();
  const parsed = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${key} must be a whole number of seconds between ${min} and ${max}, got '${text}'.`);
  }
  return parsed;
}

/**
 * Parse the `session_table_item_ttl` CDK context value (seconds).
 * Returns the default when the value is not set, and throws when it is not a
 * positive integer.
 */
export function parseSessionTableItemTtl(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_SESSION_TABLE_ITEM_TTL;
  }
  const text = String(value).trim();
  const ttl = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(ttl) || ttl <= 0) {
    throw new Error(`session_table_item_ttl must be a positive integer (seconds), got '${text}'.`);
  }
  return ttl;
}

/**
 * Parse the `step_up_max_reauth_age` CDK context value (seconds): the maximum age of the
 * re-authentication that the step-up challenge will accept.  Returns the default when the value is not
 * set, and throws unless it is a whole number within the allowed range (30 to 900 seconds).  The floor
 * keeps the window usable for a real password + MFA re-auth; the ceiling stops it being widened into a
 * long-lived replay window.
 */
export function parseStepUpMaxReauthAge(value: unknown): number {
  return parseBoundedSeconds(
    'step_up_max_reauth_age', value, DEFAULT_STEP_UP_MAX_REAUTH_AGE, MIN_STEP_UP_MAX_REAUTH_AGE, MAX_STEP_UP_MAX_REAUTH_AGE);
}

/**
 * Parse the `step_up_challenge_ttl` CDK context value (seconds): the lifetime of a one-time step-up
 * challenge minted by `/initiate-auth`.  Returns the default (600) when the value is not set, and
 * throws unless it is a whole number within the allowed range (60 to 900 seconds).
 */
export function parseStepUpChallengeTtl(value: unknown): number {
  return parseBoundedSeconds(
    'step_up_challenge_ttl', value, DEFAULT_STEP_UP_CHALLENGE_TTL, MIN_STEP_UP_CHALLENGE_TTL, MAX_STEP_UP_CHALLENGE_TTL);
}

/**
 * Parse the `step_up_challenge_clock_skew` CDK context value (seconds): the clock-skew allowance for
 * the challenge "authentication happened after the challenge" check.  Returns the default (1) when the
 * value is not set, and throws unless it is a whole number within the allowed range (0 to 10 seconds).
 * This allowance must never be widened toward the re-authentication max age.
 */
export function parseStepUpChallengeClockSkew(value: unknown): number {
  return parseBoundedSeconds(
    'step_up_challenge_clock_skew', value, DEFAULT_STEP_UP_CHALLENGE_CLOCK_SKEW, MIN_STEP_UP_SKEW, MAX_STEP_UP_SKEW);
}

/**
 * Parse the `step_up_reauth_future_skew` CDK context value (seconds): the clock-skew allowance for the
 * guard that rejects an implausibly future-dated `auth_time`.  Returns the default (5) when the value
 * is not set, and throws unless it is a whole number within the allowed range (0 to 10 seconds).
 */
export function parseStepUpReauthFutureSkew(value: unknown): number {
  return parseBoundedSeconds(
    'step_up_reauth_future_skew', value, DEFAULT_STEP_UP_REAUTH_FUTURE_SKEW, MIN_STEP_UP_SKEW, MAX_STEP_UP_SKEW);
}
