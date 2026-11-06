// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as crypto from "crypto";
import { StepUpStatusEnum } from './types';

/** Random bytes in a generated session id: 16 bytes (128 bits), rendered as 32 hex characters */
const SESSION_ID_BYTES = 16;

/**
 * Default lifetime (seconds) of a new Session object: the default and the ceiling of
 * SESSION_TABLE_ITEM_TTL.  SessionClient replaces it with the capped ttl before it writes a row, and
 * refuses to write a row whose ttl is further in the future than this.
 */
const DEFAULT_SESSION_LIFETIME_SECONDS = 900;

/**
 * Generate a random session id from a cryptographically secure random source.
 * For example, 16 random bytes <Buffer 8c aa 16 73 ...> give the id 8caa1673....
 * @param {number} bytesInId number of random bytes; at least 16 (128 bits)
 * @returns {string} hex id, twice as many characters as bytes
 * @throws {RangeError} if bytesInId is not a whole number of at least 16
 */
const generateSessionId = (bytesInId: number = SESSION_ID_BYTES): string => {
  if (!Number.isInteger(bytesInId) || bytesInId < SESSION_ID_BYTES) {
    throw new RangeError(`a session id needs at least ${SESSION_ID_BYTES} random bytes`);
  }
  return crypto.randomBytes(bytesInId).toString('hex');
};

/**
 * Model class that represents the `session` table.
 */
class Session {
  sessionId: string;
  userId?: string;
  clientId?: string;
  token?: string;
  referrerUrl?: string;
  stepUpStatus?: StepUpStatusEnum;
  createTimestamp?: string;
  lastUpdateTimestamp?: string;
  ttl: number;

  /**
   * C-TOR
   */
  constructor(sessionId?: string, userId?: string, clientId?: string, token?: string, referrerUrl?: string, stepUpStatus?: StepUpStatusEnum) {
    this.sessionId = sessionId || generateSessionId();
    this.userId = userId || "";
    this.clientId = clientId || "";
    // if token is empty then set it to sessionId
    // token cannot be empty as there an index created on it
    this.token = token || this.sessionId;
    this.referrerUrl = referrerUrl || "";
    this.stepUpStatus = stepUpStatus || StepUpStatusEnum.STEP_UP_NOT_REQUIRED;
    this.createTimestamp = "";
    this.lastUpdateTimestamp = "";
    // default ttl: 15 minutes from now, the longest lifetime a session row may have
    this.ttl = Math.floor(Date.now() / 1000) + DEFAULT_SESSION_LIFETIME_SECONDS;
  }
}

export { Session, generateSessionId, DEFAULT_SESSION_LIFETIME_SECONDS };
