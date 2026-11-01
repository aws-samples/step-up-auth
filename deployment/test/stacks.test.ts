// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { Infrastructure } from '../lib/infrastructure';
import { Api } from '../lib/api';
import { WebUI } from '../lib/webui';

// smallest valid zip file: an empty end-of-central-directory record (22 bytes)
const EMPTY_ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]);
const LAMBDA_ZIPS: [string, string][] = [
  ['step-up-authorizer', 'step-up-auth-authorizer-lambda.zip'],
  ['step-up-challenge', 'step-up-auth-challenge-lambda.zip'],
  ['step-up-initiate', 'step-up-auth-initiate-lambda.zip'],
  ['sample-api', 'step-up-auth-sample-api-lambda.zip'],
];
const ENV: cdk.Environment = { account: '123456789012', region: 'us-east-1' };
const CDK_JSON_CONTEXT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cdk.json'), 'utf8')).context;

let assetRoot: string;

beforeAll(() => {
  assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sua-cdk-test-'));
  for (const [project, zip] of LAMBDA_ZIPS) {
    const dir = path.join(assetRoot, project, 'build', 'compressed');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, zip), EMPTY_ZIP);
  }
});

afterAll(() => {
  fs.rmSync(assetRoot, { recursive: true, force: true });
});

/**
 * Build the app the same way bin/cdk.ts does and return a Template per stack,
 * keyed by the stack's construct path (e.g. 'StepUpAuthApi/Lambda').
 */
function synth(extraContext: Record<string, string> = {}): Record<string, Template> {
  const app = new cdk.App({ context: { ...CDK_JSON_CONTEXT, ...extraContext } });

  const infrastructure = new Infrastructure(app, 'StepUpAuthInfra', {
    env: ENV,
    environmentPrefix: 'test'
  });
  new Api(app, 'StepUpAuthApi', {
    env: ENV,
    environmentPrefix: 'test',
    nodeEnvironment: 'development',
    userPool: infrastructure.cognitoUserPool,
    cognitoIssuer: infrastructure.cognitoIssuer,
    apigatewayLambdaAuthorizerRole: infrastructure.apigatewayLambdaAuthorizerRole,
    apigatewayExecutionRole: infrastructure.apigatewayExecutionRole,
    lambdaExecutionRole: infrastructure.lambdaExecutionRole,
    assetRoot
  });
  new WebUI(app, 'StepUpAuthWebUi', { env: ENV });

  const templates: Record<string, Template> = {};
  for (const stack of app.node.findAll().filter(cdk.Stack.isStack)) {
    templates[stack.node.path] = Template.fromStack(stack);
  }
  return templates;
}

describe('step-up-auth CDK app', () => {
  it('synthesizes the 7 stacks', () => {
    expect(Object.keys(synth()).sort()).toStrictEqual([
      'StepUpAuthApi/APIG',
      'StepUpAuthApi/Lambda',
      'StepUpAuthInfra/Cognito',
      'StepUpAuthInfra/DynamoDb',
      'StepUpAuthInfra/IAM',
      'StepUpAuthWebUi/Cloudfront',
      'StepUpAuthWebUi/S3',
    ]);
  });

  it('runs all 4 step-up-auth Lambda functions on nodejs24.x', () => {
    const templates = synth();
    const functions = [
      ...Object.values(templates['StepUpAuthApi/Lambda'].findResources('AWS::Lambda::Function')),
      ...Object.values(templates['StepUpAuthApi/APIG'].findResources('AWS::Lambda::Function')),
    ];
    expect(functions).toHaveLength(4);
    for (const fn of functions) {
      expect(fn.Properties.Runtime).toBe('nodejs24.x');
    }
  });
});
