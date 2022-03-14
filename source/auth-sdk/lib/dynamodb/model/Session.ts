// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as crypto from "crypto";
import { StepUpStatusEnum } from './types';

/**
 * Generate random session Id.  Id is generated from a random byte array.
 * The hex representation of one byte is used for two characters in request id.
 * For example, <Buffer 8c aa 16 73 4a be 85 be> generates a request id
 * 8caa16734abe85be.
 * @param {number} bytesInId number of random bytes to use to generate request id.  If size is 0 or not a number then length defaults to 8 bytes.
 */
const generateSessionId = (bytesInId = 8) => {
  let numberOfBytesInId = bytesInId;
  const defaultNumberOfBytesInId = 8;
  if (typeof bytesInId !== 'number') {
    numberOfBytesInId = defaultNumberOfBytesInId;
  }
  if (bytesInId <= 0) {
    numberOfBytesInId = defaultNumberOfBytesInId;
  }
  numberOfBytesInId = bytesInId;
  const b = crypto.randomBytes(numberOfBytesInId);
  return b.toString('hex');
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
    // set default ttl value to 365 days from current epoch time
    const secondsInYear = 31104000; // 12 * 30 * 24 * 60 * 60;
    const now = new Date();
    this.ttl = Math.round(now.getTime() / 1000) + secondsInYear;
  }
}

export { Session };

