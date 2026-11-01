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
import { parseSessionTableItemTtl } from '../lib/context';

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
    sessionTableItemTtl: parseSessionTableItemTtl(app.node.tryGetContext('session_table_item_ttl')),
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
//   F4: SESSION_TABLE_ITEM_TTL + COGNITO_CLIENT_ID
// ----------------------------------------

/** environment variables of the function whose logical id starts with `prefix` */
function functionEnv(template: Template, prefix: string): Record<string, unknown> {
  const matches = Object.entries(template.findResources('AWS::Lambda::Function'))
    .filter(([logicalId]) => logicalId.startsWith(prefix));
  expect(matches).toHaveLength(1);
  return matches[0][1].Properties.Environment.Variables;
}

describe('authorizer and challenge environment', () => {
  const lambdaEnvs = (templates: Record<string, Template>) => [
    functionEnv(templates['StepUpAuthApi/APIG'], 'stepupauthauthorizerlambda'),
    functionEnv(templates['StepUpAuthApi/Lambda'], 'stepupauthchallengelambda'),
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

  it('rejects a session_table_item_ttl that is not a positive integer', () => {
    expect(() => synth({ session_table_item_ttl: 'abc' })).toThrow(/positive integer/);
    for (const bad of ['abc', '', '0', '-5', '1.5', '60s', 0, -1]) {
      expect(() => parseSessionTableItemTtl(bad)).toThrow(/positive integer/);
    }
    expect(parseSessionTableItemTtl(undefined)).toBe(900);
    expect(parseSessionTableItemTtl('60')).toBe(60);
    expect(parseSessionTableItemTtl(120)).toBe(120);
  });
});

// ----------------------------------------
//   F3: least-privilege DynamoDB IAM
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
//   F7: removal policies
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
//   builder-security: private bucket, HTTPS-only CloudFront
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
