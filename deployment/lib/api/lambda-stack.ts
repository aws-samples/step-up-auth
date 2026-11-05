// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface LambdaProps extends cdk.StackProps {
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
  readonly cognitoUserPool: cognito.UserPool;
  readonly cognitoUserPoolClient: cognito.UserPoolClient;
  readonly cognitoIssuer: string;
  readonly lambdaExecutionRole: iam.Role;
  /**
   * Root folder that holds the Lambda projects (<assetRoot>/<project>/build/compressed/*.zip).
   * @default path.join(__dirname, '..', '..', '..', 'source')
   */
  readonly assetRoot?: string;
}

export class LambdaStack extends cdk.Stack {
  // public readonly stepUpAuthorizerFunc: lambda.Function;
  public readonly stepUpInitiateFunc: lambda.Function;
  public readonly stepUpChallengeFunc: lambda.Function;
  public readonly stepUpSampleApiFunc: lambda.Function;

  constructor(scope: Construct, id: string, props: LambdaProps) {
    super(scope, id, props);

    const assetRoot = props.assetRoot || path.join(__dirname, '..', '..', '..', 'source');

    // ----------------------------------------
    //      step-up-auth-initiate lambda
    // ----------------------------------------
    // create file assets and upload to S3 as-is
    const stepUpInitiateAsset = new Asset(this, 'step-up-auth-initiate-asset', {
      path: path.join(assetRoot, 'step-up-initiate', 'build', 'compressed', 'step-up-auth-initiate-lambda.zip')
    });
    // create the lambda function
    this.stepUpInitiateFunc = new lambda.Function(this, 'step-up-auth-initiate-lambda', {
      code: lambda.Code.fromBucket(stepUpInitiateAsset.bucket, stepUpInitiateAsset.s3ObjectKey),
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'src/index.handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: props.lambdaExecutionRole,
      environment: {
        // the initiate function verifies the caller's access token (aws-jwt-verify) and binds the
        // one-time challenge to the gateway-authorized subject, so it needs the pool/client identifiers
        COGNITO_ISSUER: props.cognitoIssuer,
        COGNITO_USER_POOL_ARN: props.cognitoUserPool.userPoolArn,
        COGNITO_CLIENT_ID: props.cognitoUserPoolClient.userPoolClientId,
        // the initiate function constructs the shared auth-sdk SessionClient, whose base Client reads
        // SESSION_TABLE_ITEM_TTL on construction; set it so the function does not fall back and warn.
        // it does NOT affect the challenge lifetime: createChallengeSession bypasses the ttl cap and is
        // governed solely by STEP_UP_CHALLENGE_TTL.
        SESSION_TABLE_ITEM_TTL: String(props.sessionTableItemTtl),
        // the initiate function mints the one-time challenge, so it reads the challenge lifetime
        STEP_UP_CHALLENGE_TTL: String(props.stepUpChallengeTtl),
        ENV_PREFIX: props.environmentPrefix || '',
        NODE_ENV: props.nodeEnvironment || ''
      }
    });

    // ----------------------------------------
    //      step-up-auth-challenge lambda
    // ----------------------------------------
    // create file assets and upload to S3 as-is
    const stepUpChallengeAsset = new Asset(this, 'step-up-auth-challenge-asset', {
      path: path.join(assetRoot, 'step-up-challenge', 'build', 'compressed', 'step-up-auth-challenge-lambda.zip')
    });
    // create the lambda function
    this.stepUpChallengeFunc = new lambda.Function(this, 'step-up-auth-challenge-lambda', {
      code: lambda.Code.fromBucket(stepUpChallengeAsset.bucket, stepUpChallengeAsset.s3ObjectKey),
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'src/index.handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: props.lambdaExecutionRole,
      environment: {
        COGNITO_ISSUER: props.cognitoIssuer,
        COGNITO_USER_POOL_ARN: props.cognitoUserPool.userPoolArn,
        COGNITO_CLIENT_ID: props.cognitoUserPoolClient.userPoolClientId,
        SESSION_TABLE_ITEM_TTL: String(props.sessionTableItemTtl),
        STEP_UP_MAX_REAUTH_AGE: String(props.stepUpMaxReauthAge),
        // the challenge responder enforces the timing checks, so it reads both clock-skew allowances
        STEP_UP_CHALLENGE_CLOCK_SKEW: String(props.stepUpChallengeClockSkew),
        STEP_UP_REAUTH_FUTURE_SKEW: String(props.stepUpReauthFutureSkew),
        // the challenge responder's MFA check (AdminGetUser and GetUserPoolMfaConfig) runs against this pool
        USER_POOL_ID: props.cognitoUserPool.userPoolId,
        ENV_PREFIX: props.environmentPrefix || '',
        NODE_ENV: props.nodeEnvironment || ''
      }
    });
    // the responder's MFA check reads the token's user and the pool's MFA configuration, on this pool only.
    // A standalone policy in this stack (not the IAM stack) avoids a cross-stack reference cycle on the pool.
    const stepUpChallengeCognitoPolicy = new iam.Policy(this, 'StepUpAuthChallengeCognitoPolicy', {
      roles: [props.lambdaExecutionRole],
      statements: [new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminGetUser', 'cognito-idp:GetUserPoolMfaConfig'],
        resources: [props.cognitoUserPool.userPoolArn]
      })]
    });
    this.stepUpChallengeFunc.node.addDependency(stepUpChallengeCognitoPolicy);

    // ----------------------------------------
    //      step-up-auth-sample-api lambda
    // ----------------------------------------
    // create file assets and upload to S3 as-is
    const stepUpSampleApiAsset = new Asset(this, 'step-up-auth-sample-api-asset', {
      path: path.join(assetRoot, 'sample-api', 'build', 'compressed', 'step-up-auth-sample-api-lambda.zip')
    });
    // create the lambda function
    this.stepUpSampleApiFunc = new lambda.Function(this, 'step-up-auth-sample-api-lambda', {
      code: lambda.Code.fromBucket(stepUpSampleApiAsset.bucket, stepUpSampleApiAsset.s3ObjectKey),
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'src/index.handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: props.lambdaExecutionRole,
      environment: {
        ENV_PREFIX: props.environmentPrefix || '',
        NODE_ENV: props.nodeEnvironment || ''
      }
    });
  }
}
