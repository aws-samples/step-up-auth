// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeAll, beforeEach, afterEach } from '@jest/globals';
import * as path from 'path';
import { Logger } from '../index';
import config from 'config';

// unsigned JWT for log redaction tests (signature is not checked by the logger)
const base64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const TEST_JWT = [
  base64url({ kid: 'test-kid', alg: 'RS256' }),
  base64url({
    sub: 'sub-1', username: 'alice', jti: 'jti-1', exp: 2000000000, iat: 1999996400,
    token_use: 'access', scope: 'aws.cognito.signin.user.admin', client_id: 'client-1',
    email: 'alice@example.com', phone_number: '+15550100'
  }),
  'c2lnbmF0dXJl'
].join('.');

describe('Logger Test Suite', () => {
  let log: Logger;

  beforeAll(() => {
    // initialize globals
    const fileName = path.basename(__filename);
    log = new Logger(fileName);
  });

  it('logs output', async () => {
    log.debug('hello');
    expect(true).toBe(true);
  });
});

describe('Test Suite for config', () => {
  beforeAll(() => {
    if (process.env.NODE_ENV === 'local' || process.env.NODE_ENV === 'test') {
      process.env.NODE_CONFIG_DIR = path.join(__dirname, '/../test/config');
    } else {
      process.env.NODE_CONFIG_DIR = path.join(__dirname, 'config/');
    }
  });
  it('environment is set properly', async () => {
    // test NODE_ENV
    expect(process.env.NODE_ENV).toBe("test");

    // test NODE_CONFIG_DIR
    const re = /.*\/test\/config$/;
    const configDir: string = process.env.NODE_CONFIG_DIR!;
    expect(configDir.match(re)).not.toBeNull();

  });
  it('reads configuration from file', async () => {
    const level = config.get('logging.level');
    const colorize = config.get('logging.colorize_console');
    const timestamp = config.get('logging.show_timestamp');
    expect(level).not.toBeNull();
    expect(colorize).not.toBeNull();
    expect(timestamp).not.toBeNull();
  });
});

describe('Logger redaction', () => {
  const originalEnv = { ...process.env };
  const testEnv: NodeJS.ProcessEnv = {
    AWS_ACCESS_KEY_ID: 'AKIATESTACCESSKEY01',
    AWS_SECRET_ACCESS_KEY: 'test-secret-access-key-value',
    AWS_SESSION_TOKEN: 'test-session-token-value',
    MY_PASSWORD: 'hunter2',
    DB_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:x',
    API_TOKEN: 'opaque-token',
    SOME_CREDENTIAL: 'cred',
    AWS_REGION: 'us-east-1',
    SESSION_TABLE_ITEM_TTL: '900',
    NODE_ENV: 'test'
  };

  beforeEach(() => {
    delete process.env.LOG_RAW_SECRETS;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('redacts AWS credential keys and SECRET/TOKEN/PASSWORD/CREDENTIAL names', () => {
    const description = Logger.describeEnvironment(testEnv);
    expect(description.AWS_ACCESS_KEY_ID).toBe('<redacted>');
    expect(description.AWS_SECRET_ACCESS_KEY).toBe('<redacted>');
    expect(description.AWS_SESSION_TOKEN).toBe('<redacted>');
    expect(description.MY_PASSWORD).toBe('<redacted>');
    expect(description.DB_SECRET_ARN).toBe('<redacted>');
    expect(description.API_TOKEN).toBe('<redacted>');
    expect(description.SOME_CREDENTIAL).toBe('<redacted>');
    // non-sensitive values are kept, NODE_* keys are described separately by the constructor
    expect(description.AWS_REGION).toBe('us-east-1');
    expect(description.SESSION_TABLE_ITEM_TTL).toBe('900');
    expect(description).not.toHaveProperty('NODE_ENV');
  });

  it('logs raw values when LOG_RAW_SECRETS=true outside Lambda', () => {
    process.env.LOG_RAW_SECRETS = 'true';
    expect(Logger.isRawSecretsAllowed()).toBe(true);
    const description = Logger.describeEnvironment(testEnv);
    expect(description.AWS_SECRET_ACCESS_KEY).toBe('test-secret-access-key-value');
    expect(description.MY_PASSWORD).toBe('hunter2');
    expect(Logger.redactText(`token ${TEST_JWT}`)).toBe(`token ${TEST_JWT}`);
  });

  it('keeps redacting when LOG_RAW_SECRETS=true inside Lambda', () => {
    process.env.LOG_RAW_SECRETS = 'true';
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'step-up-auth-authorizer';
    expect(Logger.isRawSecretsAllowed()).toBe(false);
    const description = Logger.describeEnvironment(testEnv);
    expect(description.AWS_ACCESS_KEY_ID).toBe('<redacted>');
    expect(description.MY_PASSWORD).toBe('<redacted>');
    expect(Logger.redactText(TEST_JWT)).not.toContain(TEST_JWT);
  });

  it('replaces a JWT in log text with a summary', () => {
    const text = Logger.redactText(`headers: {"Authorization":"Bearer ${TEST_JWT}"}`);
    expect(text).not.toContain(TEST_JWT);
    expect(text).toContain('<jwt ');
    expect(text).toContain(`"prefix":"${TEST_JWT.substring(0, 12)}…"`);
    expect(text).toContain('"kid":"test-kid"');
    expect(text).toContain('"jti":"jti-1"');
    expect(text).toContain('"username":"alice"');
    expect(text).toContain('"client_id":"client-1"');
    // claims outside the summary list are dropped
    expect(text).not.toContain('alice@example.com');
    expect(text).not.toContain('+15550100');
  });

  it('replaces literal AWS credential values in log text', () => {
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-access-key-value';
    process.env.AWS_SESSION_TOKEN = 'test-session-token-value';
    const text = Logger.redactText('config: test-secret-access-key-value / test-session-token-value');
    expect(text).toBe('config: <redacted> / <redacted>');
  });

  it('masks Authorization and Identification headers without mutating the event', () => {
    const event = {
      path: '/transfer',
      headers: {
        Authorization: `Bearer ${TEST_JWT}`,
        identification: 'raw-identity-value',
        Host: 'abcdef.execute-api.us-east-1.amazonaws.com'
      },
      multiValueHeaders: {
        Authorization: [`Bearer ${TEST_JWT}`],
        identification: ['raw-identity-value'],
        Host: ['abcdef.execute-api.us-east-1.amazonaws.com']
      }
    };
    const original = JSON.parse(JSON.stringify(event));

    const sanitized = Logger.sanitizeEvent(event);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain(TEST_JWT);
    expect(serialized).not.toContain('raw-identity-value');
    expect(sanitized.headers.Authorization).toMatch(/^Bearer <jwt \{"prefix":/);
    expect(sanitized.headers.identification).toBe('<masked>');
    expect(sanitized.headers.Host).toBe('abcdef.execute-api.us-east-1.amazonaws.com');
    expect(sanitized.multiValueHeaders.Authorization[0]).toMatch(/^Bearer <jwt \{"prefix":/);
    expect(sanitized.multiValueHeaders.identification).toStrictEqual(['<masked>']);
    expect(sanitized.multiValueHeaders.Host).toStrictEqual(['abcdef.execute-api.us-east-1.amazonaws.com']);
    expect(sanitized.path).toBe('/transfer');
    // input is unchanged
    expect(event).toStrictEqual(original);
  });

  it('masks a non-JWT bearer value', () => {
    const sanitized = Logger.sanitizeEvent({ headers: { authorization: 'Bearer opaque-value' } });
    expect(sanitized.headers.authorization).toBe('<masked>');
  });
});
