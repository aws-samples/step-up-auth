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
        ENV_PREFIX: props.environmentPrefix || '',
        NODE_ENV: props.nodeEnvironment || ''
      }
    });

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
