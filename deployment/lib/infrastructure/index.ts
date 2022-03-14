// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from "@aws-cdk/core";
import * as cognito from "@aws-cdk/aws-cognito";
import * as iam from '@aws-cdk/aws-iam';
import * as dynamodb from '@aws-cdk/aws-dynamodb';

import { CognitoStack } from "./cognito-stack";
import { IamStack } from "./iam-stack";
import { DynamoDbStack } from "./dynamodb-stack";

export interface InfrastructureProps {
  readonly env: cdk.Environment;
  readonly environmentPrefix?: string;
}

export class Infrastructure extends cdk.Construct {
  public readonly cognitoUserPool: cognito.UserPool;
  public readonly cognitoIssuer: string;
  public readonly apigatewayLambdaAuthorizerRole: iam.Role;
  public readonly apigatewayExecutionRole: iam.Role;
  public readonly lambdaExecutionRole: iam.Role;
  public readonly sessionTable: dynamodb.Table;
  public readonly settingTable: dynamodb.Table;
  public readonly tokenTable: dynamodb.Table;

  constructor(scope: cdk.Construct, id: string, props: InfrastructureProps) {
    super(scope, id);

    // create IAM Stack
    const iamStack = new IamStack(this, "IAM", {
      env: props.env
    });
    this.apigatewayLambdaAuthorizerRole = iamStack.apigatewayLambdaAuthorizerRole;
    this.apigatewayExecutionRole = iamStack.apigatewayExecutionRole;
    this.lambdaExecutionRole = iamStack.lambdaExecutionRole;

    // create Cognito Stack
    const cognitoStack = new CognitoStack(this, "Cognito", {
      env: props.env,
      smsRole: iamStack.smsRole
    });
    this.cognitoUserPool = cognitoStack.userPool;
    this.cognitoIssuer = cognitoStack.cognitoIssuer;

    // create DynamoDB stack
    const dynamoDbStack = new DynamoDbStack(this, "DynamoDb", {
      env: props.env,
      environmentPrefix: props.environmentPrefix
    });
    this.sessionTable = dynamoDbStack.sessionTable;
    this.settingTable = dynamoDbStack.settingTable;
    this.tokenTable = dynamoDbStack.tokenTable;
  }
}
