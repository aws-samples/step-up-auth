// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { readBoundedIntEnv } from '@step-up-auth/auth-utils';

/**
 * Step-up session lifetime bounds (seconds).  `SESSION_TABLE_ITEM_TTL` governs how long a step-up
 * session row lives: the STEP_UP_COMPLETED elevation written on a successful re-authentication and the
 * STEP_UP_REQUIRED marker the authorizer writes.  Because a completed row grants elevated access until
 * its ttl, it is the longest-lived step-up window and must stay short.  It is therefore read through
 * the shared fail-safe parser with a finite range instead of an unbounded numeric conversion: a
 * missing, malformed, oversized or out-of-range value falls back to the secure 900s default and can
 * NEVER widen the elevated-token replay window toward the access token's full remaining lifetime.  The
 * 900s ceiling matches the challenge-ttl and re-auth-max-age ceilings so no step-up window exceeds it.
 */
const DEFAULT_SESSION_TABLE_ITEM_TTL_SECONDS = 900;
const MIN_SESSION_TABLE_ITEM_TTL_SECONDS = 60;
const MAX_SESSION_TABLE_ITEM_TTL_SECONDS = 900;

class Client {
  protected client: DynamoDBClient;
  protected awsRegion: string = "us-east-1";
  protected environmentPrefix?: string;
  protected sessionIdExpirationTimeoutInSeconds: number = 900; // 15 minutes
  protected sessionTableItemTTLInSeconds: number = DEFAULT_SESSION_TABLE_ITEM_TTL_SECONDS;

  constructor() {
    if (process.env.AWS_REGION !== undefined) {
      this.awsRegion = process.env.AWS_REGION;
    }

    if (process.env.ENV_PREFIX !== undefined && typeof process.env.ENV_PREFIX === 'string' && process.env.ENV_PREFIX.length > 0) {
      this.environmentPrefix = process.env.ENV_PREFIX;
    }

    if (process.env.SESSION_ID_EXP_TIMEOUT !== undefined && typeof process.env.SESSION_ID_EXP_TIMEOUT === 'string' && process.env.SESSION_ID_EXP_TIMEOUT.length > 0) {
      this.sessionIdExpirationTimeoutInSeconds = +process.env.SESSION_ID_EXP_TIMEOUT;
    }

    // SESSION_TABLE_ITEM_TTL is bounded and fail-safe (see the constants above): a bad or oversized
    // value falls back to the secure 900s default rather than widening the step-up session lifetime.
    this.sessionTableItemTTLInSeconds = readBoundedIntEnv(
      'SESSION_TABLE_ITEM_TTL',
      DEFAULT_SESSION_TABLE_ITEM_TTL_SECONDS,
      MIN_SESSION_TABLE_ITEM_TTL_SECONDS,
      MAX_SESSION_TABLE_ITEM_TTL_SECONDS,
    );

    // instantiate the client
    this.client = new DynamoDBClient({ region: this.awsRegion });
  }
}

export { Client };
