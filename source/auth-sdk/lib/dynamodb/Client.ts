// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

class Client {
  protected client: DynamoDBClient;
  protected awsRegion: string = "us-east-1";
  protected environmentPrefix?: string;
  protected sessionIdExpirationTimeoutInSeconds: number = 900; // 15 minutes
  protected sessionTableItemTTLInSeconds: number = 86400; // 24 hour
  protected tokenTableItemTTLInSeconds: number = 86400; // 24 hours

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

    if (process.env.SESSION_TABLE_ITEM_TTL !== undefined && typeof process.env.SESSION_TABLE_ITEM_TTL === 'string' && process.env.SESSION_TABLE_ITEM_TTL.length > 0) {
      this.sessionTableItemTTLInSeconds = +process.env.SESSION_TABLE_ITEM_TTL;
    }

    if (process.env.TOKEN_TABLE_ITEM_TTL !== undefined && typeof process.env.TOKEN_TABLE_ITEM_TTL === 'string' && process.env.TOKEN_TABLE_ITEM_TTL.length > 0) {
      this.tokenTableItemTTLInSeconds = +process.env.TOKEN_TABLE_ITEM_TTL;
    }

    // instantiate the client
    this.client = new DynamoDBClient({ region: this.awsRegion });
  }
}

export { Client };
