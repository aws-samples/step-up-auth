// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { PRE_TOKEN_GENERATION_HANDLER } from './pre-token-generation';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CognitoProps extends cdk.StackProps {}

export class CognitoStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly appClient: cognito.UserPoolClient;
  public readonly cognitoIssuer: string;

  constructor(scope: Construct, id: string, props: CognitoProps) {
    super(scope, id, props);

    // ----------------------------------------
    //           cognito user pool
    // ----------------------------------------
    this.userPool = new cognito.UserPool(this, "StepUpAuthUserPool", {
      // the V2_0 pre token generation trigger below (access token customization) needs the Essentials
      // or Plus feature plan
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      accountRecovery: cognito.AccountRecovery.NONE,
      selfSignUpEnabled: true,
      // MFA is required, with the authenticator app (TOTP) as the only factor.  Cognito makes every user
      // set up the authenticator at first sign-in (the MFA_SETUP challenge) before it issues any token, and
      // MFA can't be turned off afterwards.  The trigger below removes the aws.cognito.signin.user.admin
      // scope, so no token can register, replace or disable a factor, and the factor set up at first
      // sign-in is the only one that ever exists.  There is no SMS factor, so no SMS role is configured.
      // The step-up challenge responder refuses step-up unless the pool still has exactly this setup.
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: {
        sms: false,
        otp: true
      },
      // email and phone_number stay required attributes; the phone number is not an MFA factor
      standardAttributes: {
        email: {required: true},
        phoneNumber: {required: true}
      },
      signInAliases: {
        username: true,
        email: false
      },
      autoVerify: {
        email: true, phone: false
      },
      // explicit password policy: at least 14 characters with lower case, upper case, digit and symbol;
      // an administrator-set temporary password must be changed within 3 days
      passwordPolicy: {
        minLength: 14,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3)
      },
      // sample resources: `cdk destroy` removes the pool
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // ----------------------------------------
    //   pre token generation trigger (V2_0)
    // ----------------------------------------
    // Removes the aws.cognito.signin.user.admin scope from every access token the pool issues, so a
    // stolen browser access token cannot manage the user's MFA factors or attributes (see
    // pre-token-generation.ts).  The function has its own role that can only write its own log group;
    // the handler itself logs nothing.
    const preTokenGenerationLogGroup = new logs.LogGroup(this, 'PreTokenGenerationLogGroup', {
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    const preTokenGenerationRole = new iam.Role(this, 'PreTokenGenerationRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
    });
    // Wildcard rationale: preTokenGenerationLogGroup.logGroupArn resolves to
    // arn:<partition>:logs:<region>:<account>:log-group:<name>:*.  The trailing :* covers the log streams
    // of this one log group (a log stream's ARN is the log group's ARN followed by :log-stream:<name>).
    // Lambda creates those streams with generated names, one for each execution environment, so they
    // can't be listed in advance.
    // https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/iam-access-control-overview-cwl.html
    preTokenGenerationRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [preTokenGenerationLogGroup.logGroupArn]
    }));
    const preTokenGenerationFunc = new lambda.Function(this, 'PreTokenGenerationLambda', {
      code: lambda.Code.fromInline(PRE_TOKEN_GENERATION_HANDLER),
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      // Cognito waits at most 5 seconds for a trigger
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      role: preTokenGenerationRole,
      logGroup: preTokenGenerationLogGroup
    });
    // V2_0 events let the trigger customize access tokens; the default V1_0 covers ID tokens only.
    // addTrigger also grants cognito-idp.amazonaws.com invoke permission, limited to this pool's ARN.
    this.userPool.addTrigger(
      cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG, preTokenGenerationFunc, cognito.LambdaVersion.V2_0);

    // ----------------------------------------
    //        cognito app client pool
    // ----------------------------------------
    // Note on step-up hardening: the pool intentionally does NOT remember devices (no
    // deviceTracking configuration), so a re-authentication always challenges MFA and cannot be
    // silently skipped with a remembered-device key.  Token revocation is enabled so that a signed-out
    // session's refresh token can be revoked, shrinking the window in which a stolen token is usable.
    this.appClient = new cognito.UserPoolClient(this, "StepUpAuthWebClient", {
      userPool: this.userPool,
      generateSecret: false,
      enableTokenRevocation: true,
      refreshTokenValidity: cdk.Duration.days(1),
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: false,
        adminUserPassword: false
      },
      preventUserExistenceErrors: true
    });

    // ----------------------------------------
    //        cognito token issuer url
    // ----------------------------------------
    this.cognitoIssuer = 'https://cognito-idp.us-east-1.amazonaws.com'; // default value
    const awsRegion = props.env?.region;
    if (awsRegion !== undefined && typeof awsRegion === 'string' && awsRegion.length > 0) {
      this.cognitoIssuer = `https://cognito-idp.${awsRegion}.amazonaws.com`;
    }

    // ----------------------------------------
    //           export values
    // ----------------------------------------
    new CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
    });
    new CfnOutput(this, "UserPoolClientId", {
      value: this.appClient.userPoolClientId,
    });
  }
}
