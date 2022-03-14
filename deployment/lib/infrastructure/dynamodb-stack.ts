// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from "@aws-cdk/core";
import * as dynamodb from '@aws-cdk/aws-dynamodb';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface DynamoDbProps extends cdk.StackProps {
  readonly environmentPrefix?: string;
}

export class DynamoDbStack extends cdk.Stack {
  public readonly sessionTable: dynamodb.Table;
  public readonly settingTable: dynamodb.Table;
  public readonly tokenTable: dynamodb.Table;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  constructor(scope: cdk.Construct, id: string, props: DynamoDbProps) {
    super(scope, id, props);

    // ----------------------------------------
    //          step-up-auth-session-<env>
    // ----------------------------------------
    this.sessionTable = new dynamodb.Table(this, 'SessionTable', {
      partitionKey: {
        name: 'sessionId', type: dynamodb.AttributeType.STRING
      },
      tableName: props.environmentPrefix ? `step-up-auth-session-${props.environmentPrefix}` : 'step-up-auth-session',
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    // ----------------------------------------
    //          step-up-auth-setting-<env>
    // ----------------------------------------
    this.settingTable = new dynamodb.Table(this, 'SettingTable', {
      partitionKey: {
        name: 'id', type: dynamodb.AttributeType.STRING
      },
      tableName: props.environmentPrefix ? `step-up-auth-setting-${props.environmentPrefix}` : 'step-up-auth-setting',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    // ----------------------------------------
    //          step-up-auth-token-<env>
    // ----------------------------------------
    this.tokenTable = new dynamodb.Table(this, 'TokenTable', {
      partitionKey: {
        name: 'id', type: dynamodb.AttributeType.STRING
      },
      tableName: props.environmentPrefix ? `step-up-auth-token-${props.environmentPrefix}` : 'step-up-auth-token',
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });
  }
}
