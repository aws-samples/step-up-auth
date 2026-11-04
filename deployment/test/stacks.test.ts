// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { Infrastructure } from '../lib/infrastructure';
import { PRE_TOKEN_GENERATION_HANDLER } from '../lib/infrastructure/pre-token-generation';
import { Api } from '../lib/api';
import { WebUI } from '../lib/webui';
import {
  parseSessionTableItemTtl,
  parseStepUpMaxReauthAge,
  parseStepUpChallengeTtl,
  parseStepUpChallengeClockSkew,
  parseStepUpReauthFutureSkew } from '../lib/context';

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
  assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'step-up-auth-cdk-test-'));
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
    sessionTableItemTtl: parseSessionTableItemTtl(app.node.tryGetContext('session_table_item_ttl')),
    stepUpMaxReauthAge: parseStepUpMaxReauthAge(app.node.tryGetContext('step_up_max_reauth_age')),
    stepUpChallengeTtl: parseStepUpChallengeTtl(app.node.tryGetContext('step_up_challenge_ttl')),
    stepUpChallengeClockSkew: parseStepUpChallengeClockSkew(app.node.tryGetContext('step_up_challenge_clock_skew')),
    stepUpReauthFutureSkew: parseStepUpReauthFutureSkew(app.node.tryGetContext('step_up_reauth_future_skew')),
    userPool: infrastructure.cognitoUserPool,
    userPoolClient: infrastructure.cognitoUserPoolClient,
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

// ----------------------------------------
//   SESSION_TABLE_ITEM_TTL and COGNITO_CLIENT_ID environment variables
// ----------------------------------------

/** environment variables of the function whose logical id starts with `prefix` */
function functionEnv(template: Template, prefix: string): Record<string, unknown> {
  const matches = Object.entries(template.findResources('AWS::Lambda::Function'))
    .filter(([logicalId]) => logicalId.startsWith(prefix));
  expect(matches).toHaveLength(1);
  return matches[0][1].Properties.Environment.Variables;
}

describe('authorizer, challenge and initiate environment', () => {
  // SESSION_TABLE_ITEM_TTL is set on every function that constructs the shared auth-sdk SessionClient:
  // the authorizer and challenge responder (which read it for the step-up session rows) and the
  // initiate function (whose SessionClient reads it on construction even though its challenges bypass
  // the cap).  Setting it everywhere stops the shared client falling back and warning on each call.
  const lambdaEnvs = (templates: Record<string, Template>) => [
    functionEnv(templates['StepUpAuthApi/APIG'], 'stepupauthauthorizerlambda'),
    functionEnv(templates['StepUpAuthApi/Lambda'], 'stepupauthchallengelambda'),
    functionEnv(templates['StepUpAuthApi/Lambda'], 'stepupauthinitiatelambda'),
  ];

  it('sets SESSION_TABLE_ITEM_TTL to 900 by default, plus COGNITO_CLIENT_ID', () => {
    for (const env of lambdaEnvs(synth())) {
      expect(env.SESSION_TABLE_ITEM_TTL).toBe('900');
      expect(env.COGNITO_CLIENT_ID).toBeDefined();
      expect(JSON.stringify(env.COGNITO_CLIENT_ID)).toContain('StepUpAuthWebClient');
      expect(env.COGNITO_ISSUER).toBe('https://cognito-idp.us-east-1.amazonaws.com');
      expect(env.COGNITO_USER_POOL_ARN).toBeDefined();
    }
  });

  it('takes SESSION_TABLE_ITEM_TTL from the session_table_item_ttl context', () => {
    for (const env of lambdaEnvs(synth({ session_table_item_ttl: '60' }))) {
      expect(env.SESSION_TABLE_ITEM_TTL).toBe('60');
    }
  });

  it('gives the initiate lambda the cognito identifiers it needs to verify the access token', () => {
    const env = functionEnv(synth()['StepUpAuthApi/Lambda'], 'stepupauthinitiatelambda');
    expect(env.COGNITO_CLIENT_ID).toBeDefined();
    expect(JSON.stringify(env.COGNITO_CLIENT_ID)).toContain('StepUpAuthWebClient');
    expect(env.COGNITO_USER_POOL_ARN).toBeDefined();
    expect(env.COGNITO_ISSUER).toBe('https://cognito-idp.us-east-1.amazonaws.com');
  });

  it('places SESSION_TABLE_ITEM_TTL on the initiate lambda so its shared SessionClient does not fall back and warn', () => {
    expect(functionEnv(synth()['StepUpAuthApi/Lambda'], 'stepupauthinitiatelambda').SESSION_TABLE_ITEM_TTL).toBe('900');
    expect(functionEnv(synth({ session_table_item_ttl: '120' })['StepUpAuthApi/Lambda'], 'stepupauthinitiatelambda').SESSION_TABLE_ITEM_TTL).toBe('120');
  });

  it('rejects a session_table_item_ttl outside the 60-900 range, not a whole number, or oversized', () => {
    for (const bad of ['abc', '', '0', '-5', '1.5', '60s', '59', '901', 0, -1, 1000]) {
      expect(() => parseSessionTableItemTtl(bad)).toThrow(/between 60 and 900/);
    }
    expect(() => synth({ session_table_item_ttl: '59' })).toThrow(/between 60 and 900/);
    // an oversized all-digit value is rejected (it would otherwise convert to Infinity), not accepted
    expect(() => parseSessionTableItemTtl('9'.repeat(400))).toThrow(/between 60 and 900/);
    expect(parseSessionTableItemTtl(undefined)).toBe(900);
    expect(parseSessionTableItemTtl('60')).toBe(60);
    expect(parseSessionTableItemTtl('900')).toBe(900);
    expect(parseSessionTableItemTtl(120)).toBe(120);
  });
});

// ----------------------------------------
//   STEP_UP_MAX_REAUTH_AGE (challenge lambda only)
// ----------------------------------------

describe('step-up re-authentication max age', () => {
  it('sets STEP_UP_MAX_REAUTH_AGE to 120 by default on the challenge lambda', () => {
    const env = functionEnv(synth()['StepUpAuthApi/Lambda'], 'stepupauthchallengelambda');
    expect(env.STEP_UP_MAX_REAUTH_AGE).toBe('120');
  });

  it('takes STEP_UP_MAX_REAUTH_AGE from the step_up_max_reauth_age context', () => {
    const env = functionEnv(synth({ step_up_max_reauth_age: '60' })['StepUpAuthApi/Lambda'], 'stepupauthchallengelambda');
    expect(env.STEP_UP_MAX_REAUTH_AGE).toBe('60');
  });

  it('does not place STEP_UP_MAX_REAUTH_AGE on the initiate lambda', () => {
    const env = functionEnv(synth()['StepUpAuthApi/Lambda'], 'stepupauthinitiatelambda');
    expect(env.STEP_UP_MAX_REAUTH_AGE).toBeUndefined();
  });

  it('rejects a step_up_max_reauth_age outside the 30-900 range or not a whole number', () => {
    for (const bad of ['abc', '', '0', '-5', '1.5', '120s', '29', '901', 0, -1, 1000]) {
      expect(() => parseStepUpMaxReauthAge(bad)).toThrow(/between 30 and 900/);
    }
    expect(() => synth({ step_up_max_reauth_age: '29' })).toThrow(/between 30 and 900/);
    expect(parseStepUpMaxReauthAge(undefined)).toBe(120);
    expect(parseStepUpMaxReauthAge('30')).toBe(30);
    expect(parseStepUpMaxReauthAge('900')).toBe(900);
    expect(parseStepUpMaxReauthAge(90)).toBe(90);
  });
});

// ----------------------------------------
//   STEP_UP_CHALLENGE_TTL (initiate lambda only)
// ----------------------------------------

describe('step-up challenge lifetime', () => {
  it('sets STEP_UP_CHALLENGE_TTL to 600 by default on the initiate lambda only', () => {
    const templates = synth();
    expect(functionEnv(templates['StepUpAuthApi/Lambda'], 'stepupauthinitiatelambda').STEP_UP_CHALLENGE_TTL).toBe('600');
    // it is not placed on the challenge lambda, which does not read it
    expect(functionEnv(templates['StepUpAuthApi/Lambda'], 'stepupauthchallengelambda').STEP_UP_CHALLENGE_TTL).toBeUndefined();
  });

  it('takes STEP_UP_CHALLENGE_TTL from the step_up_challenge_ttl context', () => {
    const env = functionEnv(synth({ step_up_challenge_ttl: '300' })['StepUpAuthApi/Lambda'], 'stepupauthinitiatelambda');
    expect(env.STEP_UP_CHALLENGE_TTL).toBe('300');
  });

  it('rejects a step_up_challenge_ttl outside the 60-900 range or not a whole number', () => {
    for (const bad of ['abc', '', '0', '-5', '1.5', '600s', '59', '901', 0, 1000]) {
      expect(() => parseStepUpChallengeTtl(bad)).toThrow(/between 60 and 900/);
    }
    expect(() => synth({ step_up_challenge_ttl: '59' })).toThrow(/between 60 and 900/);
    expect(parseStepUpChallengeTtl(undefined)).toBe(600);
    expect(parseStepUpChallengeTtl('60')).toBe(60);
    expect(parseStepUpChallengeTtl('900')).toBe(900);
  });
});

// ----------------------------------------
//   STEP_UP_CHALLENGE_CLOCK_SKEW and STEP_UP_REAUTH_FUTURE_SKEW (challenge lambda only)
// ----------------------------------------

describe('step-up clock-skew allowances', () => {
  it('sets STEP_UP_CHALLENGE_CLOCK_SKEW to 1 and STEP_UP_REAUTH_FUTURE_SKEW to 5 by default on the challenge lambda', () => {
    const env = functionEnv(synth()['StepUpAuthApi/Lambda'], 'stepupauthchallengelambda');
    expect(env.STEP_UP_CHALLENGE_CLOCK_SKEW).toBe('1');
    expect(env.STEP_UP_REAUTH_FUTURE_SKEW).toBe('5');
  });

  it('does not place either clock-skew allowance on the initiate lambda', () => {
    const env = functionEnv(synth()['StepUpAuthApi/Lambda'], 'stepupauthinitiatelambda');
    expect(env.STEP_UP_CHALLENGE_CLOCK_SKEW).toBeUndefined();
    expect(env.STEP_UP_REAUTH_FUTURE_SKEW).toBeUndefined();
  });

  it('takes both allowances from their context keys', () => {
    const env = functionEnv(
      synth({ step_up_challenge_clock_skew: '0', step_up_reauth_future_skew: '10' })['StepUpAuthApi/Lambda'],
      'stepupauthchallengelambda');
    expect(env.STEP_UP_CHALLENGE_CLOCK_SKEW).toBe('0');
    expect(env.STEP_UP_REAUTH_FUTURE_SKEW).toBe('10');
  });

  it('rejects clock-skew values outside the 0-10 range or not a whole number', () => {
    for (const bad of ['abc', '', '-1', '11', '1.5', '5s', -1, 11]) {
      expect(() => parseStepUpChallengeClockSkew(bad)).toThrow(/between 0 and 10/);
      expect(() => parseStepUpReauthFutureSkew(bad)).toThrow(/between 0 and 10/);
    }
    expect(() => synth({ step_up_challenge_clock_skew: '11' })).toThrow(/between 0 and 10/);
    expect(() => synth({ step_up_reauth_future_skew: '-1' })).toThrow(/between 0 and 10/);
    expect(parseStepUpChallengeClockSkew(undefined)).toBe(1);
    expect(parseStepUpReauthFutureSkew(undefined)).toBe(5);
    expect(parseStepUpChallengeClockSkew('0')).toBe(0);
    expect(parseStepUpReauthFutureSkew('10')).toBe(10);
  });
});

// ----------------------------------------
//   Cognito app client hardening (C)
// ----------------------------------------

describe('cognito app client hardening', () => {
  it('enables token revocation on the app client', () => {
    const [client] = Object.values(synth()['StepUpAuthInfra/Cognito'].findResources('AWS::Cognito::UserPoolClient'));
    expect(client.Properties.EnableTokenRevocation).toBe(true);
  });

  it('does not configure remembered devices (re-auth always challenges MFA)', () => {
    const [pool] = Object.values(synth()['StepUpAuthInfra/Cognito'].findResources('AWS::Cognito::UserPool'));
    expect(pool.Properties.DeviceConfiguration).toBeUndefined();
  });
});

// ----------------------------------------
//   pre token generation trigger (aws.cognito.signin.user.admin suppression)
// ----------------------------------------

describe('pre token generation trigger', () => {
  let cognitoTemplate: Template;
  beforeAll(() => { cognitoTemplate = synth()['StepUpAuthInfra/Cognito']; });

  /** the user pool, and the only function in the Cognito stack (the trigger) with its logical id */
  function poolAndTrigger() {
    const [pool] = Object.values(cognitoTemplate.findResources('AWS::Cognito::UserPool'));
    const functions = Object.entries(cognitoTemplate.findResources('AWS::Lambda::Function'));
    expect(functions).toHaveLength(1);
    const [[triggerLogicalId, trigger]] = functions;
    return { pool, triggerLogicalId, trigger };
  }

  it('wires a V2_0 trigger on the user pool, with no legacy V1 trigger', () => {
    const { pool, triggerLogicalId } = poolAndTrigger();
    expect(pool.Properties.LambdaConfig).toStrictEqual({
      PreTokenGenerationConfig: {
        LambdaArn: { 'Fn::GetAtt': [triggerLogicalId, 'Arn'] },
        LambdaVersion: 'V2_0'
      }
    });
  });

  it('keeps the pool on the Essentials feature plan, which V2_0 triggers need', () => {
    expect(poolAndTrigger().pool.Properties.UserPoolTier).toBe('ESSENTIALS');
  });

  it('deploys the inline handler on nodejs24.x with no environment', () => {
    const { trigger } = poolAndTrigger();
    expect(trigger.Properties.Runtime).toBe('nodejs24.x');
    expect(trigger.Properties.Handler).toBe('index.handler');
    expect(trigger.Properties.Code).toStrictEqual({ ZipFile: PRE_TOKEN_GENERATION_HANDLER });
    expect(trigger.Properties.Environment).toBeUndefined();
  });

  it('lets only this user pool invoke the trigger', () => {
    const { triggerLogicalId } = poolAndTrigger();
    const permissions = Object.values(cognitoTemplate.findResources('AWS::Lambda::Permission'));
    expect(permissions).toHaveLength(1);
    const [permission] = permissions;
    expect(permission.Properties).toStrictEqual({
      Action: 'lambda:InvokeFunction',
      FunctionName: { 'Fn::GetAtt': [triggerLogicalId, 'Arn'] },
      Principal: 'cognito-idp.amazonaws.com',
      SourceArn: { 'Fn::GetAtt': [expect.stringMatching(/^StepUpAuthUserPool/), 'Arn'] }
    });
  });

  it('runs under its own role that can only write its own log group', () => {
    const { trigger } = poolAndTrigger();
    const roleLogicalId = trigger.Properties.Role['Fn::GetAtt'][0];
    const role = cognitoTemplate.toJSON().Resources[roleLogicalId];
    expect(role.Type).toBe('AWS::IAM::Role');
    expect(role.Properties.AssumeRolePolicyDocument.Statement).toStrictEqual([
      { Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' } }
    ]);
    expect(role.Properties.ManagedPolicyArns).toBeUndefined();
    expect(role.Properties.Policies).toBeUndefined();

    const policies = Object.values(cognitoTemplate.findResources('AWS::IAM::Policy'))
      .filter((p) => JSON.stringify(p.Properties.Roles).includes(roleLogicalId));
    expect(policies).toHaveLength(1);
    const logGroupLogicalId = trigger.Properties.LoggingConfig.LogGroup.Ref;
    expect(policies[0].Properties.PolicyDocument.Statement).toStrictEqual([{
      Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      Effect: 'Allow',
      Resource: { 'Fn::GetAtt': [logGroupLogicalId, 'Arn'] }
    }]);
    expect(cognitoTemplate.toJSON().Resources[logGroupLogicalId].DeletionPolicy).toBe('Delete');
  });

  it('does not make the built-in Cognito authorizer require any scope, so suppressed tokens still reach the step-up endpoints', () => {
    const methods = Object.values(synth()['StepUpAuthApi/APIG'].findResources('AWS::ApiGateway::Method'))
      .filter((m) => m.Properties.AuthorizationType === 'COGNITO_USER_POOLS');
    // POST /initiate-auth and POST /respond-to-challenge
    expect(methods).toHaveLength(2);
    for (const method of methods) {
      expect(method.Properties.AuthorizationScopes).toBeUndefined();
    }
  });
});

// ----------------------------------------
//   least-privilege DynamoDB IAM
// ----------------------------------------

type Statement = { Effect: string; Action: string | string[]; Resource?: unknown; Principal?: unknown };

/** every statement of every IAM policy, inline role policy and bucket policy */
function allStatements(templates: Record<string, Template>, types: string[]): Statement[] {
  const statements: Statement[] = [];
  for (const template of Object.values(templates)) {
    for (const type of types) {
      for (const resource of Object.values(template.findResources(type))) {
        const docs = type === 'AWS::IAM::Role'
          ? (resource.Properties.Policies || []).map((p: { PolicyDocument: unknown }) => p.PolicyDocument)
          : [resource.Properties.PolicyDocument];
        for (const doc of docs) {
          statements.push(...(doc as { Statement: Statement[] }).Statement);
        }
      }
    }
  }
  return statements;
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

describe('IAM', () => {
  let templates: Record<string, Template>;
  beforeAll(() => { templates = synth(); });

  it('never grants a DynamoDB action on Resource *', () => {
    const dynamoStatements = allStatements(templates, ['AWS::IAM::Policy', 'AWS::IAM::Role'])
      .filter((s) => asArray(s.Action).some((a) => String(a).startsWith('dynamodb:')));
    expect(dynamoStatements).toHaveLength(1);
    const [statement] = dynamoStatements;
    expect(asArray(statement.Action).sort()).toStrictEqual(
      ['dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem']);
    const resources = asArray(statement.Resource);
    expect(resources).toHaveLength(3);
    for (const resource of resources) {
      expect(resource).not.toBe('*');
      expect(JSON.stringify(resource)).toMatch(/SessionTable|SettingTable|TokenTable/);
    }
  });

  it('does not attach AmazonDynamoDBFullAccess to any role', () => {
    for (const template of Object.values(templates)) {
      expect(JSON.stringify(template.toJSON())).not.toContain('AmazonDynamoDBFullAccess');
    }
  });
});

// ----------------------------------------
//   removal policies
// ----------------------------------------

describe('removal policies', () => {
  let templates: Record<string, Template>;
  beforeAll(() => { templates = synth(); });

  it.each([
    ['StepUpAuthInfra/Cognito', 'AWS::Cognito::UserPool', 1],
    ['StepUpAuthInfra/DynamoDb', 'AWS::DynamoDB::Table', 3],
    ['StepUpAuthWebUi/S3', 'AWS::S3::Bucket', 1],
  ])('%s %s has DeletionPolicy Delete', (stack, type, count) => {
    const resources = Object.values(templates[stack].findResources(type));
    expect(resources).toHaveLength(count);
    for (const resource of resources) {
      expect(resource.DeletionPolicy).toBe('Delete');
      expect(resource.UpdateReplacePolicy).toBe('Delete');
    }
  });

  it('empties the web bucket on delete', () => {
    expect(Object.keys(templates['StepUpAuthWebUi/S3'].findResources('Custom::S3AutoDeleteObjects'))).toHaveLength(1);
  });
});

// ----------------------------------------
//   private web bucket and HTTPS-only CloudFront
// ----------------------------------------

describe('web UI exposure', () => {
  let templates: Record<string, Template>;
  beforeAll(() => { templates = synth(); });

  it('blocks all public access on the web bucket', () => {
    const [bucket] = Object.values(templates['StepUpAuthWebUi/S3'].findResources('AWS::S3::Bucket'));
    expect(bucket.Properties.PublicAccessBlockConfiguration).toStrictEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(bucket.Properties.OwnershipControls).toStrictEqual({ Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] });
    expect(bucket.Properties.BucketEncryption).toBeDefined();
  });

  it('allows no anonymous principal and denies non-TLS requests', () => {
    const statements = allStatements(templates, ['AWS::S3::BucketPolicy']);
    for (const statement of statements.filter((s) => s.Effect === 'Allow')) {
      expect(statement.Principal).not.toBe('*');
      expect(JSON.stringify(statement.Principal)).not.toMatch(/"AWS":"\*"/);
    }
    expect(statements).toContainEqual(expect.objectContaining({
      Effect: 'Deny',
      Condition: { Bool: { 'aws:SecureTransport': 'false' } },
    }));
    // CloudFront reads through the origin access identity only
    const reads = statements.filter((s) => s.Effect === 'Allow' && asArray(s.Action).includes('s3:GetObject'));
    expect(reads).toHaveLength(1);
    expect(JSON.stringify(reads[0].Principal)).toContain('CanonicalUser');
  });

  it('serves the distribution over HTTPS only, from the bucket through an OAI', () => {
    const cloudfrontTemplate = templates['StepUpAuthWebUi/Cloudfront'];
    const [distribution] = Object.values(cloudfrontTemplate.findResources('AWS::CloudFront::Distribution'));
    const config = distribution.Properties.DistributionConfig;
    expect(config.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
    expect(config.Origins).toHaveLength(1);
    expect(JSON.stringify(config.Origins[0].S3OriginConfig.OriginAccessIdentity)).toContain('origin-access-identity/cloudfront/');
    expect(config.Origins[0].OriginAccessControlId).toBeUndefined();
  });
});
