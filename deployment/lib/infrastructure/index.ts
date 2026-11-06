// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

import { CognitoStack } from "./cognito-stack";
import { DynamoDbStack } from "./dynamodb-stack";

export interface InfrastructureProps {
  readonly env: cdk.Environment;
  readonly environmentPrefix?: string;
}

export class Infrastructure extends Construct {
  public readonly cognitoUserPool: cognito.UserPool;
  public readonly cognitoUserPoolClient: cognito.UserPoolClient;
  public readonly cognitoIssuer: string;
  public readonly sessionTable: dynamodb.Table;
  public readonly settingTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: InfrastructureProps) {
    super(scope, id);

    // create Cognito Stack
    const cognitoStack = new CognitoStack(this, "Cognito", {
      env: props.env
    });
    this.cognitoUserPool = cognitoStack.userPool;
    this.cognitoUserPoolClient = cognitoStack.appClient;
    this.cognitoIssuer = cognitoStack.cognitoIssuer;

    // create DynamoDB stack
    const dynamoDbStack = new DynamoDbStack(this, "DynamoDb", {
      env: props.env,
      environmentPrefix: props.environmentPrefix
    });
    this.sessionTable = dynamoDbStack.sessionTable;
    this.settingTable = dynamoDbStack.settingTable;

    // IAM: each Lambda function has its own execution role, created next to the function in the Api
    // stacks (lib/api), with only the table and user pool actions that function makes
  }
}
