// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

import { CognitoStack } from "./cognito-stack";
import { IamStack } from "./iam-stack";
import { DynamoDbStack } from "./dynamodb-stack";

export interface InfrastructureProps {
  readonly env: cdk.Environment;
  readonly environmentPrefix?: string;
}

export class Infrastructure extends Construct {
  public readonly cognitoUserPool: cognito.UserPool;
  public readonly cognitoUserPoolClient: cognito.UserPoolClient;
  public readonly cognitoIssuer: string;
  public readonly apigatewayLambdaAuthorizerRole: iam.Role;
  public readonly apigatewayExecutionRole: iam.Role;
  public readonly lambdaExecutionRole: iam.Role;
  public readonly sessionTable: dynamodb.Table;
  public readonly settingTable: dynamodb.Table;
  public readonly tokenTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: InfrastructureProps) {
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
    this.cognitoUserPoolClient = cognitoStack.appClient;
    this.cognitoIssuer = cognitoStack.cognitoIssuer;

    // create DynamoDB stack
    const dynamoDbStack = new DynamoDbStack(this, "DynamoDb", {
      env: props.env,
      environmentPrefix: props.environmentPrefix
    });
    this.sessionTable = dynamoDbStack.sessionTable;
    this.settingTable = dynamoDbStack.settingTable;
    this.tokenTable = dynamoDbStack.tokenTable;

    // least privilege: the Lambdas only make these item-level calls, and only
    // on the step-up-auth tables
    this.lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem'
      ],
      resources: [
        this.sessionTable.tableArn,
        this.settingTable.tableArn,
        this.tokenTable.tableArn
      ]
    }));
  }
}
