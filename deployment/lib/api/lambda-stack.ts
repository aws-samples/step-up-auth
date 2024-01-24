// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as path from 'path';
import * as cdk from '@aws-cdk/core';
import * as lambda from '@aws-cdk/aws-lambda';
import * as cognito from '@aws-cdk/aws-cognito';
import { Asset } from '@aws-cdk/aws-s3-assets';
import * as iam from '@aws-cdk/aws-iam';

export interface LambdaProps extends cdk.StackProps {
  readonly environmentPrefix?: string;
  readonly nodeEnvironment?: string;
  readonly cognitoUserPool: cognito.UserPool;
  readonly cognitoIssuer: string;
  readonly lambdaExecutionRole: iam.Role;
}

export class LambdaStack extends cdk.Stack {
  // public readonly stepUpAuthorizerFunc: lambda.Function;
  public readonly stepUpInitiateFunc: lambda.Function;
  public readonly stepUpChallengeFunc: lambda.Function;
  public readonly stepUpSampleApiFunc: lambda.Function;

  constructor(scope: cdk.Construct, id: string, props: LambdaProps) {
    super(scope, id, props);

    // ----------------------------------------
    //      step-up-auth-initiate lambda
    // ----------------------------------------
    // create file assets and upload to S3 as-is
    const stepUpInitiateAsset = new Asset(this, 'step-up-auth-initiate-asset', {
      path: path.join(__dirname, '..', '..', '..', 'source', 'step-up-initiate', 'build', 'compressed', 'step-up-auth-initiate-lambda.zip')
    });
    // create the lambda function
    this.stepUpInitiateFunc = new lambda.Function(this, 'step-up-auth-initiate-lambda', {
      code: lambda.Code.fromBucket(stepUpInitiateAsset.bucket, stepUpInitiateAsset.s3ObjectKey),
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'src/index.handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: props.lambdaExecutionRole,
      environment: {
        ENV_PREFIX: props.environmentPrefix || '',
        NODE_ENV: props.nodeEnvironment || ''
      }
    });

    // ----------------------------------------
    //      step-up-auth-challenge lambda
    // ----------------------------------------
    // create file assets and upload to S3 as-is
    const stepUpChallengeAsset = new Asset(this, 'step-up-auth-challenge-asset', {
      path: path.join(__dirname, '..', '..', '..', 'source', 'step-up-challenge', 'build', 'compressed', 'step-up-auth-challenge-lambda.zip')
    });
    // create the lambda function
    this.stepUpChallengeFunc = new lambda.Function(this, 'step-up-auth-challenge-lambda', {
      code: lambda.Code.fromBucket(stepUpChallengeAsset.bucket, stepUpChallengeAsset.s3ObjectKey),
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'src/index.handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: props.lambdaExecutionRole,
      environment: {
        COGNITO_ISSUER: props.cognitoIssuer,
        COGNITO_USER_POOL_ARN: props.cognitoUserPool.userPoolArn,
        ENV_PREFIX: props.environmentPrefix || '',
        NODE_ENV: props.nodeEnvironment || ''
      }
    });

    // ----------------------------------------
    //      step-up-auth-sample-api lambda
    // ----------------------------------------
    // create file assets and upload to S3 as-is
    const stepUpSampleApiAsset = new Asset(this, 'step-up-auth-sample-api-asset', {
      path: path.join(__dirname, '..', '..', '..', 'source', 'sample-api', 'build', 'compressed', 'step-up-auth-sample-api-lambda.zip')
    });
    // create the lambda function
    this.stepUpSampleApiFunc = new lambda.Function(this, 'step-up-auth-sample-api-lambda', {
      code: lambda.Code.fromBucket(stepUpSampleApiAsset.bucket, stepUpSampleApiAsset.s3ObjectKey),
      runtime: lambda.Runtime.NODEJS_16_X,
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
