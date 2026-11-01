// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/** Default step-up session lifetime in seconds (15 minutes). */
export const DEFAULT_SESSION_TABLE_ITEM_TTL = 900;

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
