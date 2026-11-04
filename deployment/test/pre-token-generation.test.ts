// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as vm from 'vm';
import { describe, expect, it } from '@jest/globals';

import { PRE_TOKEN_GENERATION_HANDLER, SUPPRESSED_ACCESS_TOKEN_SCOPE } from '../lib/infrastructure/pre-token-generation';

type Handler = (event: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * Load the exact inline source that CDK deploys, as the CommonJS module Lambda runs, in a sandbox whose
 * console records every call.
 */
function loadHandler(): { handler: Handler; consoleCalls: unknown[][] } {
  const consoleCalls: unknown[][] = [];
  const record = (...args: unknown[]) => { consoleCalls.push(args); };
  const sandboxConsole = { log: record, info: record, warn: record, error: record, debug: record, trace: record };
  const module = { exports: {} as { handler?: Handler } };
  vm.runInNewContext(PRE_TOKEN_GENERATION_HANDLER, { module, exports: module.exports, console: sandboxConsole });
  expect(typeof module.exports.handler).toBe('function');
  return { handler: module.exports.handler as Handler, consoleCalls };
}

/** a version two pre token generation event, shaped like the example in the Amazon Cognito docs */
function v2Event(triggerSource: string, scopes?: string[]): Record<string, unknown> {
  return {
    version: '2',
    triggerSource,
    region: 'us-east-1',
    userPoolId: 'us-east-1_EXAMPLE',
    userName: 'example-user',
    callerContext: { awsSdkVersion: 'aws-sdk-unknown-unknown', clientId: '1example23456789' },
    request: {
      userAttributes: { sub: 'a1b2c3d4-5678-90ab-cdef-EXAMPLE11111', email: 'user@example.com', phone_number: '+12065550100' },
      groupConfiguration: { groupsToOverride: [], iamRolesToOverride: [], preferredRole: null },
      ...(scopes === undefined ? {} : { scopes })
    },
    response: { claimsAndScopeOverrideDetails: null }
  };
}

// the objects come from another vm realm; compare their JSON form
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

const EXPECTED_RESPONSE = {
  claimsAndScopeOverrideDetails: {
    accessTokenGeneration: { scopesToSuppress: ['aws.cognito.signin.user.admin'] }
  }
};

describe('pre token generation trigger', () => {
  it('suppresses the aws.cognito.signin.user.admin scope', () => {
    expect(SUPPRESSED_ACCESS_TOKEN_SCOPE).toBe('aws.cognito.signin.user.admin');
  });

  it.each([
    'TokenGeneration_Authentication',
    'TokenGeneration_RefreshTokens',
    'TokenGeneration_NewPasswordChallenge',
    'TokenGeneration_HostedAuth',
    'TokenGeneration_AuthenticateDevice',
    'TokenGeneration_SomeFutureSource',
  ])('suppresses the scope for %s and changes nothing else', async (triggerSource) => {
    const { handler } = loadHandler();
    const event = v2Event(triggerSource, ['aws.cognito.signin.user.admin']);
    const request = plain(event.request);
    const result = await handler(event);
    // Cognito reads the returned event
    expect(result).toBe(event);
    expect(plain(result.response)).toStrictEqual(EXPECTED_RESPONSE);
    // no claims or scopes added, no ID token or group changes, request untouched
    expect(plain(result.request)).toStrictEqual(request);
  });

  it('suppresses the scope whatever the request carries', async () => {
    const { handler } = loadHandler();
    for (const event of [
      v2Event('TokenGeneration_Authentication'),
      v2Event('TokenGeneration_Authentication', []),
      v2Event('TokenGeneration_RefreshTokens', ['openid', 'aws.cognito.signin.user.admin', 'email']),
      { ...v2Event('TokenGeneration_Authentication'), response: undefined },
    ]) {
      expect(plain((await handler(event)).response)).toStrictEqual(EXPECTED_RESPONSE);
    }
  });

  it('does not branch on the trigger source or read the request', () => {
    expect(PRE_TOKEN_GENERATION_HANDLER).not.toMatch(/triggerSource|event\.request|if\s*\(|switch\s*\(|\?/);
  });

  it('logs nothing', async () => {
    const { handler, consoleCalls } = loadHandler();
    await handler(v2Event('TokenGeneration_Authentication', ['aws.cognito.signin.user.admin']));
    await handler(v2Event('TokenGeneration_RefreshTokens', ['aws.cognito.signin.user.admin']));
    expect(consoleCalls).toStrictEqual([]);
    expect(PRE_TOKEN_GENERATION_HANDLER).not.toMatch(/console/);
  });
});
