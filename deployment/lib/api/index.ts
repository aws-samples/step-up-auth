// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

import { LambdaStack } from './lambda-stack';
import { ApiGatewayStack } from './api-gateway-stack';

export interface ApiProps {
  readonly env: cdk.Environment;
  readonly environmentPrefix?: string;
  readonly nodeEnvironment?: string;
  /** step-up session lifetime in seconds (SESSION_TABLE_ITEM_TTL) */
  readonly sessionTableItemTtl: number;
  /** maximum age in seconds of the re-authentication that step-up accepts (STEP_UP_MAX_REAUTH_AGE) */
  readonly stepUpMaxReauthAge: number;
  /** one-time step-up challenge lifetime in seconds (STEP_UP_CHALLENGE_TTL) */
  readonly stepUpChallengeTtl: number;
  /** clock-skew allowance in seconds for the "authenticated after the challenge" check (STEP_UP_CHALLENGE_CLOCK_SKEW) */
  readonly stepUpChallengeClockSkew: number;
  /** clock-skew allowance in seconds for the future-dated auth_time guard (STEP_UP_REAUTH_FUTURE_SKEW) */
  readonly stepUpReauthFutureSkew: number;
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly cognitoIssuer: string;
  /** step-up session table (sessions and one-time challenges) */
  readonly sessionTable: dynamodb.ITable;
  /** api step-up setting table */
  readonly settingTable: dynamodb.ITable;
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
      stepUpMaxReauthAge: props.stepUpMaxReauthAge,
      stepUpChallengeTtl: props.stepUpChallengeTtl,
      stepUpChallengeClockSkew: props.stepUpChallengeClockSkew,
      stepUpReauthFutureSkew: props.stepUpReauthFutureSkew,
      cognitoUserPool: props.userPool,
      cognitoUserPoolClient: props.userPoolClient,
      cognitoIssuer: props.cognitoIssuer,
      sessionTable: props.sessionTable,
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
      sessionTableItemTtl: props.sessionTableItemTtl,
      cognitoUserPool: props.userPool,
      cognitoUserPoolClient: props.userPoolClient,
      cognitoIssuer: props.cognitoIssuer,
      sessionTable: props.sessionTable,
      settingTable: props.settingTable,
      assetRoot: props.assetRoot
    });
    this.apiUrl = apiGatewayStack.apiUrl;
  }
}
