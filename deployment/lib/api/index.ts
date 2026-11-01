// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

import { LambdaStack } from './lambda-stack';
import { ApiGatewayStack } from './api-gateway-stack';

export interface ApiProps {
  readonly env: cdk.Environment;
  readonly environmentPrefix?: string;
  readonly nodeEnvironment?: string;
  /** step-up session lifetime in seconds (SESSION_TABLE_ITEM_TTL) */
  readonly sessionTableItemTtl: number;
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly cognitoIssuer: string;
  readonly apigatewayLambdaAuthorizerRole: iam.Role;
  readonly apigatewayExecutionRole: iam.Role;
  readonly lambdaExecutionRole: iam.Role;
  /**
   * Root folder that holds the Lambda projects (<assetRoot>/<project>/build/compressed/*.zip).
   * @default path.join(__dirname, '..', '..', '..', 'source')
   */
  readonly assetRoot?: string;
}

export class Api extends Construct {
  public readonly apiUrl?: string;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    // create Lambda Stack
    const lambdaStack = new LambdaStack(this, 'Lambda', {
      env: props.env,
      environmentPrefix: props.environmentPrefix,
      nodeEnvironment: props.nodeEnvironment,
      sessionTableItemTtl: props.sessionTableItemTtl,
      cognitoUserPool: props.userPool,
      cognitoUserPoolClient: props.userPoolClient,
      cognitoIssuer: props.cognitoIssuer,
      lambdaExecutionRole: props.lambdaExecutionRole,
      assetRoot: props.assetRoot
    });

    // create API Gateway Stack
    const apiGatewayStack = new ApiGatewayStack(this, 'APIG', {
      env: props.env,
      environmentPrefix: props.environmentPrefix,
      nodeEnvironment: props.nodeEnvironment,
      stepUpInitiateFunc: lambdaStack.stepUpInitiateFunc,
      stepUpChallengeFunc: lambdaStack.stepUpChallengeFunc,
      stepUpSampleApiFunc: lambdaStack.stepUpSampleApiFunc,
      lambdaExecutionRole: props.lambdaExecutionRole,
      sessionTableItemTtl: props.sessionTableItemTtl,
      cognitoUserPool: props.userPool,
      cognitoUserPoolClient: props.userPoolClient,
      cognitoIssuer: props.cognitoIssuer,
      apigatewayLambdaAuthorizerRole: props.apigatewayLambdaAuthorizerRole,
      apigatewayExecutionRole: props.apigatewayExecutionRole,
      assetRoot: props.assetRoot
    });
    this.apiUrl = apiGatewayStack.apiUrl;
  }
}
