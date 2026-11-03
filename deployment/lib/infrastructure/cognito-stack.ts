// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface CognitoProps extends cdk.StackProps {
  readonly smsRole: iam.Role;
}

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
      accountRecovery: cognito.AccountRecovery.NONE,
      selfSignUpEnabled: true,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: true,
        otp: true
      },
      standardAttributes: {
        email: {required: true},
        phoneNumber: {required: true}
      },
      smsRole: props.smsRole,
      signInAliases: {
        username: true,
        email: false
      },
      autoVerify: {
        email: true, phone: false
      },
      // sample resources: `cdk destroy` removes the pool
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

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
