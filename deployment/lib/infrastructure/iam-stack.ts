// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface IamProps extends cdk.StackProps {}

export class IamStack extends cdk.Stack {
  public readonly apigatewayLambdaAuthorizerRole: iam.Role;
  public readonly apigatewayExecutionRole: iam.Role;
  public readonly lambdaExecutionRole: iam.Role;
  public readonly smsRole: iam.Role;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  constructor(scope: cdk.Construct, id: string, props: IamProps) {
    super(scope, id, props);

    // ----------------------------------------
    //          request authorizer role
    // ----------------------------------------
    this.apigatewayLambdaAuthorizerRole = new iam.Role(this, 'StepUpAuthAPIGatewayLambdaAuthorizerRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });
    this.apigatewayLambdaAuthorizerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: ['lambda:InvokeFunction'],
    }));
    this.apigatewayLambdaAuthorizerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Scan',
        // 'dynamodb:BatchGetItem',
        // 'dynamodb:BatchWriteItem'
      ],
    }));

    // ----------------------------------------
    //        api gateway execution role
    // ----------------------------------------
    this.apigatewayExecutionRole = new iam.Role(this, 'StepUpAuthAPIGatewayExecutionRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });
    this.apigatewayExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs')
    );
    this.apigatewayExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaRole')
    );

    // ----------------------------------------
    //         lambda execution role
    // ----------------------------------------
    this.lambdaExecutionRole = new iam.Role(this, 'StepUpAuthLambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    this.lambdaExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite')
    );
    this.lambdaExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess')
    );
    this.lambdaExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambdaExecute')
    );
    this.lambdaExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoPowerUser')
    );

    // ----------------------------------------
    //          cognito sms role
    // ----------------------------------------
    const smsRole = new iam.Role(this, 'StepUpAuthUserPoolSmsRole', {
      assumedBy: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
    });
    smsRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: ['sns:publish']
    }));
  }
}
