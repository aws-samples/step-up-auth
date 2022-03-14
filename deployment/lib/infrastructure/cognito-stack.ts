// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from "@aws-cdk/core";
import * as cognito from "@aws-cdk/aws-cognito";
import * as iam from '@aws-cdk/aws-iam';
import { CfnOutput } from "@aws-cdk/core";

export interface CognitoProps extends cdk.StackProps {
  readonly smsRole: iam.Role;
}

export class CognitoStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly appClient: cognito.UserPoolClient;
  public readonly cognitoIssuer: string;

  constructor(scope: cdk.Construct, id: string, props: CognitoProps) {
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
      }
    });

    // ----------------------------------------
    //        cognito app client pool
    // ----------------------------------------
    this.appClient = new cognito.UserPoolClient(this, "StepUpAuthWebClient", {
      userPool: this.userPool,
      generateSecret: false,
      enableTokenRevocation: false,
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
