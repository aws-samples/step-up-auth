// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from '@aws-cdk/core';
import * as cognito from '@aws-cdk/aws-cognito';
import * as iam from '@aws-cdk/aws-iam';

import { LambdaStack } from './lambda-stack';
import { ApiGatewayStack } from './api-gateway-stack';

export interface ApiProps {
  readonly env: cdk.Environment;
  readonly environmentPrefix?: string;
  readonly nodeEnvironment?: string;
  readonly userPool: cognito.UserPool;
  readonly cognitoIssuer: string;
  readonly apigatewayLambdaAuthorizerRole: iam.Role;
  readonly apigatewayExecutionRole: iam.Role;
  readonly lambdaExecutionRole: iam.Role;
}

export class Api extends cdk.Construct {
  public readonly apiUrl?: string;

  constructor(scope: cdk.Construct, id: string, props: ApiProps) {
    super(scope, id);

    // create Lambda Stack
    const lambdaStack = new LambdaStack(this, 'Lambda', {
      env: props.env,
      environmentPrefix: props.environmentPrefix,
      nodeEnvironment: props.nodeEnvironment,
      cognitoUserPool: props.userPool,
      cognitoIssuer: props.cognitoIssuer,
      lambdaExecutionRole: props.lambdaExecutionRole
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
      cognitoUserPool: props.userPool,
      cognitoIssuer: props.cognitoIssuer,
      apigatewayLambdaAuthorizerRole: props.apigatewayLambdaAuthorizerRole,
      apigatewayExecutionRole: props.apigatewayExecutionRole,
    });
    this.apiUrl = apiGatewayStack.apiUrl;
  }
}
