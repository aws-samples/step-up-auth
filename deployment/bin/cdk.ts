// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Infrastructure } from '../lib/infrastructure';
import { Api } from '../lib/api';
import { WebUI } from '../lib/webui';
import { parseSessionTableItemTtl, parseStepUpMaxReauthAge } from '../lib/context';

const app = new cdk.App();

// pre-flight checks - set common variables that are used across all stacks
const awsRegion: string | undefined =
  process.env.AWS_REGION || app.node.tryGetContext("aws_region");
const awsAccount: string | undefined =
  process.env.AWS_ACCOUNT || app.node.tryGetContext("aws_account");

if (!awsRegion || !awsAccount) {
  throw new Error(
    "Please set either the AWS_REGION and AWS_ACCOUNT environment " +
      "variables, or the aws_region and aws_account context values."
  );
}

const environmentPrefix: string | undefined = app.node.tryGetContext("env_prefix");
if (environmentPrefix && environmentPrefix.length <= 0) { // check for zero length string
  throw new Error("Please set env_prefix to 'prod', 'dev', or 'test'.  empty string values are invalid.");
}

const nodeEnvironment: string | undefined =
  process.env.NODE_ENV || app.node.tryGetContext("node_env") || 'development'; // default to 'development' mode

// step-up session lifetime in seconds (default 900); throws unless it is a positive integer
const sessionTableItemTtl: number = parseSessionTableItemTtl(app.node.tryGetContext("session_table_item_ttl"));

// maximum age (seconds) of the re-authentication that step-up will accept (default 120)
const stepUpMaxReauthAge: number = parseStepUpMaxReauthAge(app.node.tryGetContext("step_up_max_reauth_age"));

/* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
const environment: cdk.Environment = {
  region: awsRegion,
  account: awsAccount,
};

// create infrastructure stack first
const infrastructure = new Infrastructure(app, "StepUpAuthInfra", {
  env: environment,
  environmentPrefix: environmentPrefix
});

// create the api-gateway and lambda stack
new Api(app, "StepUpAuthApi", {
  env: environment,
  environmentPrefix: environmentPrefix,
  nodeEnvironment: nodeEnvironment,
  sessionTableItemTtl: sessionTableItemTtl,
  stepUpMaxReauthAge: stepUpMaxReauthAge,
  userPool: infrastructure.cognitoUserPool,
  userPoolClient: infrastructure.cognitoUserPoolClient,
  cognitoIssuer: infrastructure.cognitoIssuer,
  apigatewayLambdaAuthorizerRole: infrastructure.apigatewayLambdaAuthorizerRole,
  apigatewayExecutionRole: infrastructure.apigatewayExecutionRole,
  lambdaExecutionRole: infrastructure.lambdaExecutionRole
});

// create s3 and cloudfront stacks to host sample-web-app
new WebUI(app, "StepUpAuthWebUi", {
  env: environment
});
