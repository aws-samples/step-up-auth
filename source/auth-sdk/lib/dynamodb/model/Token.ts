// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { v4 as uuidV4 } from 'uuid';
import { TokenStatusEnum, TokenChannelTypeEnum } from './types';
/**
 * Generate random one-time pass-code/password (OTP) of a given length.  OTP
 * is represented by 'temporary token' in Token class.  OTP consists of numbers.
 * @param {number} otpLength length of OTP to generate
 */
const generateTemporaryToken = (otpLength = 6) => {
  // create multiplier in form 9000... number of zero's equal otpLength
  // also convert the multiplier to number using short-hand '+' notation
  const multiplier = +`9${new Array(otpLength).join( '0' )}`;
  // create floorThreshold in form 1000... number of zero's equal otpLength
  // also convert the multiplier to number using short-hand '+' notation
  const floorThreshold = +`1${new Array(otpLength).join( '0' )}`;
  // create random number
  const randomNumber = Math.floor(floorThreshold + (Math.random() * multiplier));
  // return string representation of the random number
  return Math.floor(randomNumber).toString();
};

class Token {
  id: string;
  temporaryToken?: string;
  status?: TokenStatusEnum;
  channel?: TokenChannelTypeEnum;
  createTimestamp?: string;
  lastUpdateTimestamp?: string;
  ttl: number;

  constructor(id?: string) {
    if (typeof id === undefined) {
      throw Error("id cannot be empty");
    }
    this.id = id || uuidV4();
    this.temporaryToken = generateTemporaryToken();
    this.createTimestamp = "";
    this.lastUpdateTimestamp = "";
    // set default ttl value to 365 days from current epoch time
    const secondsInYear = 31104000; // 12 * 30 * 24 * 60 * 60;
    const now = new Date();
    this.ttl = Math.round(now.getTime() / 1000) + secondsInYear;
  }
}

export { Token };
