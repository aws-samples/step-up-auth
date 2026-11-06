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
    sessionTable: infrastructure.sessionTable,
    settingTable: infrastructure.settingTable,
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
  it('synthesizes the 5 stacks', () => {
    expect(Object.keys(synth()).sort()).toStrictEqual([
      'StepUpAuthApi/APIG',
      'StepUpAuthApi/Lambda',
      'StepUpAuthInfra/Cognito',
      'StepUpAuthInfra/DynamoDb',
      'StepUpAuthWebUi/Cloudfront',
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
//   required authenticator-app MFA, and no SMS
// ----------------------------------------

describe('cognito user pool MFA', () => {
  let templates: Record<string, Template>;
  let pool: ReturnType<Template['findResources']>[string];
  beforeAll(() => {
    templates = synth();
    [pool] = Object.values(templates['StepUpAuthInfra/Cognito'].findResources('AWS::Cognito::UserPool'));
  });

  it('requires MFA with the authenticator app (TOTP) as the only factor', () => {
    expect(pool.Properties.MfaConfiguration).toBe('ON');
    expect(pool.Properties.EnabledMfas).toStrictEqual(['SOFTWARE_TOKEN_MFA']);
  });

  it('configures no SMS sending on the pool', () => {
    expect(pool.Properties.SmsConfiguration).toBeUndefined();
  });

  it('creates no IAM role that Cognito can assume, in any stack', () => {
    for (const template of Object.values(templates)) {
      for (const role of Object.values(template.findResources('AWS::IAM::Role'))) {
        expect(JSON.stringify(role.Properties.AssumeRolePolicyDocument)).not.toContain('cognito-idp.amazonaws.com');
      }
    }
  });

  it('grants no sns: action in any policy', () => {
    const snsStatements = allStatements(templates, ['AWS::IAM::Policy', 'AWS::IAM::Role', 'AWS::IAM::ManagedPolicy'])
      .filter((s) => asArray(s.Action).some((a) => String(a).toLowerCase().startsWith('sns:')));
    expect(snsStatements).toStrictEqual([]);
  });

  it('keeps email and phone_number as required attributes', () => {
    expect(pool.Properties.Schema).toEqual(expect.arrayContaining([
      expect.objectContaining({ Name: 'email', Required: true }),
      expect.objectContaining({ Name: 'phone_number', Required: true }),
    ]));
  });

  it('keeps the Essentials plan and does not remember devices', () => {
    expect(pool.Properties.UserPoolTier).toBe('ESSENTIALS');
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
//   least-privilege IAM: one role per Lambda function, no managed policies, no wildcards
// ----------------------------------------

type Statement = { Effect: string; Action: string | string[]; Resource?: unknown; Principal?: unknown; Condition?: unknown };

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

/** the CDK-managed provider role that empties the buckets on delete (not one of the sample's functions) */
const isAutoDeleteProviderRole = (logicalId: string): boolean =>
  logicalId.startsWith('CustomS3AutoDeleteObjectsCustomResourceProviderRole');

/** logical id of the execution role of the function whose logical id starts with `prefix` */
function functionRoleId(template: Template, prefix: string): string {
  const matches = Object.entries(template.findResources('AWS::Lambda::Function'))
    .filter(([logicalId]) => logicalId.startsWith(prefix));
  expect(matches).toHaveLength(1);
  return matches[0][1].Properties.Role['Fn::GetAtt'][0];
}

/**
 * Effective permissions of a role in `template`: every "action resource" pair granted by the IAM
 * policies attached to it, with the resource rendered as JSON.  Fails on a Deny or a condition, which
 * the sample's function roles don't use.
 */
function rolePermissions(template: Template, roleLogicalId: string): string[] {
  const pairs: string[] = [];
  for (const policy of Object.values(template.findResources('AWS::IAM::Policy'))) {
    if (!JSON.stringify(policy.Properties.Roles).includes(`"${roleLogicalId}"`)) {
      continue;
    }
    for (const statement of policy.Properties.PolicyDocument.Statement as Statement[]) {
      expect(statement.Effect).toBe('Allow');
      expect(statement.Condition).toBeUndefined();
      for (const action of asArray(statement.Action)) {
        for (const resource of asArray(statement.Resource)) {
          pairs.push(`${action} ${JSON.stringify(resource)}`);
        }
      }
    }
  }
  return pairs.sort();
}

/** the JSON rendering of a resource reference that contains `pattern`, e.g. the session table ARN */
const ref = (pattern: RegExp) => expect.stringMatching(pattern);

describe('IAM', () => {
  let templates: Record<string, Template>;
  beforeAll(() => { templates = synth(); });

  const FUNCTIONS: [string, string][] = [
    ['StepUpAuthApi/APIG', 'stepupauthauthorizerlambda'],
    ['StepUpAuthApi/Lambda', 'stepupauthinitiatelambda'],
    ['StepUpAuthApi/Lambda', 'stepupauthchallengelambda'],
    ['StepUpAuthApi/Lambda', 'stepupauthsampleapilambda'],
  ];

  it('gives each of the 4 step-up functions its own execution role', () => {
    const roles = FUNCTIONS.map(([stack, prefix]) => `${stack}/${functionRoleId(templates[stack], prefix)}`);
    expect(new Set(roles).size).toBe(4);
    for (const [stack, prefix] of FUNCTIONS) {
      const role = templates[stack].toJSON().Resources[functionRoleId(templates[stack], prefix)];
      expect(role.Type).toBe('AWS::IAM::Role');
      expect(role.Properties.AssumeRolePolicyDocument.Statement).toStrictEqual([
        { Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' } }
      ]);
      expect(role.Properties.ManagedPolicyArns).toBeUndefined();
      expect(role.Properties.Policies).toBeUndefined();
    }
  });

  it('attaches no AWS managed policy to any role except the CDK bucket auto-delete provider', () => {
    for (const template of Object.values(templates)) {
      const roles = Object.entries(template.findResources('AWS::IAM::Role'))
        .filter(([logicalId]) => !isAutoDeleteProviderRole(logicalId));
      for (const [, role] of roles) {
        expect(role.Properties.ManagedPolicyArns).toBeUndefined();
      }
      expect(Object.keys(template.findResources('AWS::IAM::ManagedPolicy'))).toHaveLength(0);
      const json = JSON.stringify(template.toJSON());
      for (const managed of ['SecretsManagerReadWrite', 'AWSLambdaExecute', 'AmazonCognitoPowerUser', 'AWSLambdaRole',
        'AmazonAPIGatewayPushToCloudWatchLogs', 'AmazonDynamoDBFullAccess']) {
        expect(json).not.toContain(managed);
      }
    }
  });

  it('grants no Allow on Resource * and no wildcard action', () => {
    for (const statement of allStatements(templates, ['AWS::IAM::Policy', 'AWS::IAM::Role']).filter((s) => s.Effect === 'Allow')) {
      expect(asArray(statement.Resource)).not.toContain('*');
      for (const action of asArray(statement.Action)) {
        expect(String(action)).not.toContain('*');
      }
    }
  });

  it('lets the authorizer read the setting table and read and write the session table only', () => {
    const template = templates['StepUpAuthApi/APIG'];
    const permissions = rolePermissions(template, functionRoleId(template, 'stepupauthauthorizerlambda'));
    expect(permissions).toHaveLength(5);
    expect(permissions).toStrictEqual(expect.arrayContaining([
      ref(/^dynamodb:GetItem .*SettingTable/),
      ref(/^dynamodb:GetItem .*SessionTable/),
      ref(/^dynamodb:PutItem .*SessionTable/),
      ref(/^logs:CreateLogStream .*stepupauthauthorizerloggroup/),
      ref(/^logs:PutLogEvents .*stepupauthauthorizerloggroup/),
    ]));
  });

  it('lets the initiate function write the session table only', () => {
    const template = templates['StepUpAuthApi/Lambda'];
    const permissions = rolePermissions(template, functionRoleId(template, 'stepupauthinitiatelambda'));
    expect(permissions).toHaveLength(3);
    expect(permissions).toStrictEqual(expect.arrayContaining([
      ref(/^dynamodb:PutItem .*SessionTable/),
      ref(/^logs:CreateLogStream .*stepupauthinitiateloggroup/),
      ref(/^logs:PutLogEvents .*stepupauthinitiateloggroup/),
    ]));
  });

  it('lets the challenge responder use the session table and read the user pool MFA state only', () => {
    const template = templates['StepUpAuthApi/Lambda'];
    const permissions = rolePermissions(template, functionRoleId(template, 'stepupauthchallengelambda'));
    expect(permissions).toHaveLength(7);
    expect(permissions).toStrictEqual(expect.arrayContaining([
      ref(/^dynamodb:GetItem .*SessionTable/),
      ref(/^dynamodb:PutItem .*SessionTable/),
      ref(/^dynamodb:DeleteItem .*SessionTable/),
      ref(/^cognito-idp:AdminGetUser .*StepUpAuthUserPool\w*Arn/),
      ref(/^cognito-idp:GetUserPoolMfaConfig .*StepUpAuthUserPool\w*Arn/),
      ref(/^logs:CreateLogStream .*stepupauthchallengeloggroup/),
      ref(/^logs:PutLogEvents .*stepupauthchallengeloggroup/),
    ]));
  });

  it('lets the sample API write its own log group only', () => {
    const template = templates['StepUpAuthApi/Lambda'];
    const permissions = rolePermissions(template, functionRoleId(template, 'stepupauthsampleapilambda'));
    expect(permissions).toHaveLength(2);
    expect(permissions).toStrictEqual(expect.arrayContaining([
      ref(/^logs:CreateLogStream .*stepupauthsampleapiloggroup/),
      ref(/^logs:PutLogEvents .*stepupauthsampleapiloggroup/),
    ]));
  });

  it('grants DynamoDB actions on the session and setting tables only', () => {
    const dynamoStatements = allStatements(templates, ['AWS::IAM::Policy', 'AWS::IAM::Role'])
      .filter((s) => asArray(s.Action).some((a) => String(a).startsWith('dynamodb:')));
    expect(dynamoStatements.length).toBeGreaterThan(0);
    for (const statement of dynamoStatements) {
      for (const resource of asArray(statement.Resource)) {
        expect(JSON.stringify(resource)).toMatch(/SessionTable|SettingTable/);
      }
    }
  });

  it('creates no IAM role that API Gateway can assume', () => {
    for (const template of Object.values(templates)) {
      for (const role of Object.values(template.findResources('AWS::IAM::Role'))) {
        expect(JSON.stringify(role.Properties.AssumeRolePolicyDocument)).not.toContain('apigateway.amazonaws.com');
      }
      expect(Object.keys(template.findResources('AWS::ApiGateway::Account'))).toHaveLength(0);
    }
  });

  it('scopes every Lambda permission for API Gateway to this API with aws:SourceArn', () => {
    const permissions = Object.values(templates['StepUpAuthApi/APIG'].findResources('AWS::Lambda::Permission'));
    // 4 methods x (stage + test-invoke) plus the request authorizer
    expect(permissions).toHaveLength(9);
    for (const permission of permissions) {
      expect(permission.Properties.Principal).toBe('apigateway.amazonaws.com');
      const sourceArn = JSON.stringify(permission.Properties.SourceArn);
      expect(sourceArn).toContain('execute-api');
      expect(sourceArn).toMatch(/stepupauthapi/);
    }
    const authorizerPermissions = permissions.filter((p) => JSON.stringify(p.Properties.SourceArn).includes('/authorizers/'));
    expect(authorizerPermissions).toHaveLength(1);
    expect(JSON.stringify(authorizerPermissions[0].Properties.FunctionName)).toContain('stepupauthauthorizerlambda');
  });

  it('configures neither authorizer credentials nor integration credentials', () => {
    const template = templates['StepUpAuthApi/APIG'];
    for (const authorizer of Object.values(template.findResources('AWS::ApiGateway::Authorizer'))) {
      expect(authorizer.Properties.AuthorizerCredentials).toBeUndefined();
    }
    for (const method of Object.values(template.findResources('AWS::ApiGateway::Method'))) {
      expect(method.Properties.Integration?.Credentials).toBeUndefined();
    }
  });
});

// ----------------------------------------
//   challenge responder MFA check (USER_POOL_ID)
// ----------------------------------------

describe('challenge responder MFA check', () => {
  let templates: Record<string, Template>;
  beforeAll(() => { templates = synth(); });

  it('sets USER_POOL_ID to the user pool id on the challenge lambda only', () => {
    const lambdaTemplate = templates['StepUpAuthApi/Lambda'];
    expect(JSON.stringify(functionEnv(lambdaTemplate, 'stepupauthchallengelambda').USER_POOL_ID))
      .toMatch(/OutputRefStepUpAuthUserPool/);
    expect(functionEnv(lambdaTemplate, 'stepupauthinitiatelambda').USER_POOL_ID).toBeUndefined();
    expect(functionEnv(lambdaTemplate, 'stepupauthsampleapilambda').USER_POOL_ID).toBeUndefined();
    expect(functionEnv(templates['StepUpAuthApi/APIG'], 'stepupauthauthorizerlambda').USER_POOL_ID).toBeUndefined();
  });

  it('grants AdminGetUser and GetUserPoolMfaConfig in one statement, on the user pool ARN, to the challenge role only', () => {
    const cognitoStatements = allStatements(templates, ['AWS::IAM::Policy', 'AWS::IAM::Role'])
      .filter((s) => asArray(s.Action).some((a) => String(a).startsWith('cognito-idp:')));
    expect(cognitoStatements).toHaveLength(1);
    const [statement] = cognitoStatements;
    expect(statement.Effect).toBe('Allow');
    expect(asArray(statement.Action).sort()).toStrictEqual(['cognito-idp:AdminGetUser', 'cognito-idp:GetUserPoolMfaConfig']);
    const resources = asArray(statement.Resource);
    expect(resources).toHaveLength(1);
    expect(JSON.stringify(resources[0])).toMatch(/OutputFnGetAttStepUpAuthUserPool\w*Arn/);
  });

  it('creates the challenge lambda after its role policy', () => {
    const lambdaTemplate = templates['StepUpAuthApi/Lambda'];
    const roleId = functionRoleId(lambdaTemplate, 'stepupauthchallengelambda');
    const [[policyLogicalId]] = Object.entries(lambdaTemplate.findResources('AWS::IAM::Policy'))
      .filter(([, policy]) => JSON.stringify(policy.Properties.Roles).includes(`"${roleId}"`));
    const [challenge] = Object.entries(lambdaTemplate.findResources('AWS::Lambda::Function'))
      .filter(([logicalId]) => logicalId.startsWith('stepupauthchallengelambda'))
      .map(([, resource]) => resource);
    expect(challenge.DependsOn).toContain(policyLogicalId);
  });
});

// ----------------------------------------
//   log groups
// ----------------------------------------

describe('log groups', () => {
  let templates: Record<string, Template>;
  beforeAll(() => { templates = synth(); });

  it.each([
    ['StepUpAuthApi/APIG', 'stepupauthauthorizerlambda'],
    ['StepUpAuthApi/Lambda', 'stepupauthinitiatelambda'],
    ['StepUpAuthApi/Lambda', 'stepupauthchallengelambda'],
    ['StepUpAuthApi/Lambda', 'stepupauthsampleapilambda'],
  ])('%s %s writes its own log group with a 30-day retention, removed with the stack', (stack, prefix) => {
    const [fn] = Object.entries(templates[stack].findResources('AWS::Lambda::Function'))
      .filter(([logicalId]) => logicalId.startsWith(prefix)).map(([, r]) => r);
    const logGroupId = fn.Properties.LoggingConfig.LogGroup.Ref;
    const logGroup = templates[stack].toJSON().Resources[logGroupId];
    expect(logGroup.Type).toBe('AWS::Logs::LogGroup');
    expect(logGroup.Properties.RetentionInDays).toBe(30);
    expect(logGroup.DeletionPolicy).toBe('Delete');
  });

  it('sets a retention on every log group in the app', () => {
    for (const template of Object.values(templates)) {
      for (const logGroup of Object.values(template.findResources('AWS::Logs::LogGroup'))) {
        expect(logGroup.Properties.RetentionInDays).toBeGreaterThan(0);
        expect(logGroup.DeletionPolicy).toBe('Delete');
      }
    }
  });
});

// ----------------------------------------
//   API Gateway: endpoint, logging, throttling, request validation
// ----------------------------------------

describe('API Gateway', () => {
  let template: Template;
  beforeAll(() => { template = synth()['StepUpAuthApi/APIG']; });

  it('uses a regional endpoint with the TLS_1_2 security policy', () => {
    const [api] = Object.values(template.findResources('AWS::ApiGateway::RestApi'));
    expect(api.Properties.EndpointConfiguration).toStrictEqual({ Types: ['REGIONAL'] });
    expect(api.Properties.SecurityPolicy).toBe('TLS_1_2');
  });

  it('writes stage access logs as JSON to a log group with a retention', () => {
    const [stage] = Object.values(template.findResources('AWS::ApiGateway::Stage'));
    expect(stage.Properties.StageName).toBe('dev');
    // the destination is the access log group's ARN (rendered with or without a trailing ':*')
    const [[logGroupId, logGroup]] = Object.entries(template.findResources('AWS::Logs::LogGroup'))
      .filter(([id]) => id.startsWith('accessloggroup'));
    expect(JSON.stringify(stage.Properties.AccessLogSetting.DestinationArn)).toContain(`"${logGroupId}"`);
    expect(logGroup.Type).toBe('AWS::Logs::LogGroup');
    expect(logGroup.Properties.RetentionInDays).toBe(30);
    const format = JSON.parse(stage.Properties.AccessLogSetting.Format);
    expect(format).toEqual(expect.objectContaining({ requestId: '$context.requestId', status: '$context.status' }));
  });

  it('enables execution logging at ERROR without data tracing, and throttles every method', () => {
    const [stage] = Object.values(template.findResources('AWS::ApiGateway::Stage'));
    expect(stage.Properties.MethodSettings).toStrictEqual([{
      DataTraceEnabled: false,
      HttpMethod: '*',
      LoggingLevel: 'ERROR',
      ResourcePath: '/*',
      ThrottlingBurstLimit: 20,
      ThrottlingRateLimit: 10
    }]);
  });

  it('declares the execution log group with a retention before the stage', () => {
    const [[groupId, group]] = Object.entries(template.findResources('AWS::Logs::LogGroup'))
      .filter(([, g]) => JSON.stringify(g.Properties.LogGroupName || '').includes('API-Gateway-Execution-Logs_'));
    expect(JSON.stringify(group.Properties.LogGroupName)).toContain('/dev');
    expect(group.Properties.RetentionInDays).toBe(30);
    const [stage] = Object.values(template.findResources('AWS::ApiGateway::Stage'));
    expect(stage.DependsOn).toContain(groupId);
  });

  it('validates the POST /respond-to-challenge body against a JSON model', () => {
    const validators = Object.entries(template.findResources('AWS::ApiGateway::RequestValidator'));
    expect(validators).toHaveLength(1);
    const [[validatorId, validator]] = validators;
    expect(validator.Properties.ValidateRequestBody).toBe(true);
    const [[modelId, model]] = Object.entries(template.findResources('AWS::ApiGateway::Model'));
    expect(model.Properties.ContentType).toBe('application/json');
    expect(model.Properties.Schema.properties.challengeId).toStrictEqual({ type: 'string', pattern: '^[0-9a-f]{32}$' });
    // a missing challengeId is not a validation error: the function answers 401 NO_CHALLENGE
    expect(model.Properties.Schema.required).toBeUndefined();

    const posts = Object.values(template.findResources('AWS::ApiGateway::Method'))
      .filter((m) => m.Properties.HttpMethod === 'POST' && m.Properties.AuthorizationType === 'COGNITO_USER_POOLS'
        && m.Properties.RequestValidatorId);
    expect(posts).toHaveLength(1);
    expect(posts[0].Properties.RequestValidatorId).toStrictEqual({ Ref: validatorId });
    expect(posts[0].Properties.RequestModels).toStrictEqual({ 'application/json': { Ref: modelId } });
  });

  it('authorizes every non-OPTIONS method; OPTIONS preflights are mock integrations', () => {
    const methods = Object.values(template.findResources('AWS::ApiGateway::Method'));
    expect(methods).toHaveLength(8);
    const preflights = methods.filter((m) => m.Properties.HttpMethod === 'OPTIONS');
    const others = methods.filter((m) => m.Properties.HttpMethod !== 'OPTIONS');
    expect(preflights).toHaveLength(4);
    for (const method of preflights) {
      expect(method.Properties.Integration.Type).toBe('MOCK');
    }
    for (const method of others) {
      expect(['CUSTOM', 'COGNITO_USER_POOLS']).toContain(method.Properties.AuthorizationType);
      expect(method.Properties.AuthorizerId).toBeDefined();
    }
  });
});

// ----------------------------------------
//   Cognito password policy
// ----------------------------------------

describe('cognito password policy', () => {
  it('requires 14 characters with lower case, upper case, digit and symbol', () => {
    const [pool] = Object.values(synth()['StepUpAuthInfra/Cognito'].findResources('AWS::Cognito::UserPool'));
    expect(pool.Properties.Policies.PasswordPolicy).toStrictEqual({
      MinimumLength: 14,
      RequireLowercase: true,
      RequireUppercase: true,
      RequireNumbers: true,
      RequireSymbols: true,
      TemporaryPasswordValidityDays: 3
    });
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
    ['StepUpAuthInfra/DynamoDb', 'AWS::DynamoDB::Table', 2],
    ['StepUpAuthWebUi/Cloudfront', 'AWS::S3::Bucket', 2],
  ])('%s %s has DeletionPolicy Delete', (stack, type, count) => {
    const resources = Object.values(templates[stack].findResources(type));
    expect(resources).toHaveLength(count);
    for (const resource of resources) {
      expect(resource.DeletionPolicy).toBe('Delete');
      expect(resource.UpdateReplacePolicy).toBe('Delete');
    }
  });

  it('creates only the session and setting tables', () => {
    const names = Object.values(templates['StepUpAuthInfra/DynamoDb'].findResources('AWS::DynamoDB::Table'))
      .map((t) => t.Properties.TableName).sort();
    expect(names).toStrictEqual(['step-up-auth-session-test', 'step-up-auth-setting-test']);
  });

  it('empties both web UI buckets on delete', () => {
    expect(Object.keys(templates['StepUpAuthWebUi/Cloudfront'].findResources('Custom::S3AutoDeleteObjects'))).toHaveLength(2);
  });
});

// ----------------------------------------
//   private web bucket, origin access control, HTTPS-only CloudFront
// ----------------------------------------

describe('web UI exposure', () => {
  let template: Template;
  let webBucketId: string;
  let logBucketId: string;
  let distributionId: string;
  beforeAll(() => {
    template = synth()['StepUpAuthWebUi/Cloudfront'];
    const buckets = Object.entries(template.findResources('AWS::S3::Bucket'));
    webBucketId = buckets.find(([, b]) => b.Properties.BucketName)![0];
    logBucketId = buckets.find(([, b]) => !b.Properties.BucketName)![0];
    distributionId = Object.keys(template.findResources('AWS::CloudFront::Distribution'))[0];
  });

  /** statements of the bucket policy of `bucketId` */
  const bucketStatements = (bucketId: string): Statement[] => {
    const [policy] = Object.values(template.findResources('AWS::S3::BucketPolicy'))
      .filter((p) => JSON.stringify(p.Properties.Bucket) === JSON.stringify({ Ref: bucketId }));
    return policy.Properties.PolicyDocument.Statement;
  };

  it('blocks all public access and encrypts both buckets', () => {
    for (const bucketId of [webBucketId, logBucketId]) {
      const bucket = template.toJSON().Resources[bucketId];
      expect(bucket.Properties.PublicAccessBlockConfiguration).toStrictEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(bucket.Properties.BucketEncryption).toBeDefined();
      expect(bucket.Properties.LifecycleConfiguration.Rules.length).toBeGreaterThan(0);
    }
    const web = template.toJSON().Resources[webBucketId];
    expect(web.Properties.OwnershipControls).toStrictEqual({ Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] });
    expect(web.Properties.LoggingConfiguration).toStrictEqual({
      DestinationBucketName: { Ref: logBucketId },
      LogFilePrefix: 'web-bucket/'
    });
    // access logs expire after 30 days
    const log = template.toJSON().Resources[logBucketId];
    expect(log.Properties.LifecycleConfiguration.Rules[0].ExpirationInDays).toBe(30);
  });

  it('allows no anonymous principal and denies non-TLS requests on both buckets', () => {
    for (const bucketId of [webBucketId, logBucketId]) {
      const statements = bucketStatements(bucketId);
      for (const statement of statements.filter((s) => s.Effect === 'Allow')) {
        expect(statement.Principal).not.toBe('*');
        expect(JSON.stringify(statement.Principal)).not.toMatch(/"AWS":"\*"/);
      }
      expect(statements).toContainEqual(expect.objectContaining({
        Effect: 'Deny',
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      }));
    }
  });

  it('lets only this distribution read the web bucket, through an origin access control', () => {
    const reads = bucketStatements(webBucketId).filter((s) => s.Effect === 'Allow' && asArray(s.Action).includes('s3:GetObject'));
    expect(reads).toHaveLength(1);
    expect(reads[0].Principal).toStrictEqual({ Service: 'cloudfront.amazonaws.com' });
    expect(JSON.stringify(reads[0].Condition)).toContain('"AWS:SourceArn"');
    expect(JSON.stringify(reads[0].Condition)).toContain(`{"Ref":"${distributionId}"}`);
    expect(JSON.stringify(template.toJSON())).not.toContain('CanonicalUser');
    expect(Object.keys(template.findResources('AWS::CloudFront::CloudFrontOriginAccessIdentity'))).toHaveLength(0);

    const [distribution] = Object.values(template.findResources('AWS::CloudFront::Distribution'));
    const config = distribution.Properties.DistributionConfig;
    expect(config.Origins).toHaveLength(1);
    expect(config.Origins[0].OriginAccessControlId).toBeDefined();
    expect(config.Origins[0].S3OriginConfig.OriginAccessIdentity).toBe('');
  });

  it('serves the distribution over HTTPS only, with security headers and access logging', () => {
    const [distribution] = Object.values(template.findResources('AWS::CloudFront::Distribution'));
    const config = distribution.Properties.DistributionConfig;
    expect(config.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
    expect(config.Logging).toStrictEqual({
      Bucket: { 'Fn::GetAtt': [logBucketId, 'RegionalDomainName'] },
      Prefix: 'cloudfront/'
    });

    const policyId = config.DefaultCacheBehavior.ResponseHeadersPolicyId.Ref;
    const headers = template.toJSON().Resources[policyId].Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig;
    expect(headers.FrameOptions).toStrictEqual({ FrameOption: 'DENY', Override: true });
    expect(headers.ContentSecurityPolicy).toStrictEqual({ ContentSecurityPolicy: "frame-ancestors 'none'", Override: true });
    expect(headers.StrictTransportSecurity).toStrictEqual({ AccessControlMaxAgeSec: 31536000, IncludeSubdomains: true, Override: true });
    expect(headers.ContentTypeOptions).toStrictEqual({ Override: true });
  });
});
