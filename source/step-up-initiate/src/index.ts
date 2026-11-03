// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  Context,
  APIGatewayProxyEvent,
  APIGatewayProxyEventHeaders,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { Logger, CognitoToken, readBoundedIntEnv } from '@step-up-auth/auth-utils';
import { SessionClient, StepUpStatusEnum } from '@step-up-auth/auth-sdk';
import * as crypto from 'crypto';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

const BASE_HEADERS = {
  'Access-Control-Allow-Headers':
    'Content-Type,X-Amz-Date,Authorization,identification,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
};

const BEARER_RE = /^Bearer [A-Za-z0-9-_=.]+$/;

/** 401 used for every unauthenticated/identity-mismatch case; it never reveals which check failed. */
const unauthenticated = (): APIGatewayProxyResult => ({
  statusCode: 401,
  headers: BASE_HEADERS,
  body: JSON.stringify({ code: 'UNAUTHENTICATED' }),
});

/**
 * Default lifetime, in seconds, of a one-time step-up re-authentication challenge (10 minutes).  It
 * only needs to survive long enough for the user to re-authenticate before `/respond-to-challenge`
 * consumes it, so it is kept short.  The challenge's creation time (not this ttl) is the load-bearing
 * control: completion requires a fresh `auth_time` strictly after the challenge was created.
 * Overridable with the `STEP_UP_CHALLENGE_TTL` env var (whole seconds, 60 to 900 inclusive); a missing
 * or out-of-range value falls back to this default.
 */
const DEFAULT_CHALLENGE_TTL_SECONDS = 600;
/** Smallest accepted `STEP_UP_CHALLENGE_TTL` (seconds). */
const MIN_CHALLENGE_TTL_SECONDS = 60;
/** Largest accepted `STEP_UP_CHALLENGE_TTL` (seconds). */
const MAX_CHALLENGE_TTL_SECONDS = 900;

/**
 * Return the value of a request header, matching the header name case-insensitively.
 * Amplify JS v6 sends lowercase header names and API Gateway REST passes names as sent.
 * @param headers request headers
 * @param name header name
 * @returns header value, or undefined if the header is not present
 */
const getHeader = (headers: APIGatewayProxyEventHeaders | null | undefined, name: string): string | undefined => {
  if (!headers) {
    return undefined;
  }
  const headerName = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return headerName === undefined ? undefined : headers[headerName];
};

/**
 * Step-up Auth Initiate API Proxy Lambda handler.
 *
 * Step-up is satisfied by a fresh re-authentication (see the respond-to-challenge function), so this
 * endpoint no longer inspects the user's MFA configuration or sends any code.  Instead it mints a
 * one-time, server-bound challenge: a random `challengeId` and a short-lived challenge record (keyed by
 * `challenge#<challengeId>`) that stores the caller's `sub` and a server-set creation time.  The client
 * then re-authenticates with Cognito (password plus the user's existing MFA) and calls
 * `/respond-to-challenge` with the freshly issued tokens and the `challengeId`.  Completion is accepted
 * only when the fresh token's `auth_time` is strictly after this challenge's creation time, so a stolen
 * or merely refreshed token (whose `auth_time` predates the challenge) can never satisfy step-up.
 * @param event Lambda event object
 * @param context Lambda request context object
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  log.debug('event: ', JSON.stringify(Logger.sanitizeEvent(event)));
  log.debug('context ', JSON.stringify(context));

  if (event.path === '/initiate-auth' && event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: BASE_HEADERS, body: '{}' };
  }

  if (event.path === '/initiate-auth' && event.httpMethod === 'POST') {
    // This endpoint sits behind the API Gateway Cognito authorizer, which has already cryptographically
    // verified the caller's id token and placed its claims on the request context.  The challenge
    // subject is taken from that gateway-verified id token (`requestContext.authorizer.claims.sub`),
    // NOT from the Authorization value, which the gateway never checked.  We additionally verify the
    // caller's access token and require its subject to equal the authorized id-token subject.  So a
    // caller can only mint a challenge for the exact user the gateway authenticated: a forged or
    // victim-substituted Authorization value is rejected here rather than merely decoded.
    const authorizationHeader = getHeader(event.headers, 'Authorization');
    if (!authorizationHeader || !BEARER_RE.test(authorizationHeader)) {
      return unauthenticated();
    }

    // authoritative subject: the gateway-verified id token's `sub` from the request context
    const authorizer = event.requestContext && event.requestContext.authorizer
      ? (event.requestContext.authorizer as { claims?: Record<string, unknown> })
      : undefined;
    const idSub = authorizer && authorizer.claims && typeof authorizer.claims.sub === 'string'
      ? authorizer.claims.sub
      : '';
    if (!idSub) {
      log.warn('initiate rejected: request context carries no gateway-authorized subject');
      return unauthenticated();
    }

    // cryptographically verify the caller's access token and require it to be for the SAME subject
    let accessSub = '';
    try {
      const access = new CognitoToken(authorizationHeader);
      if (access.isAccessToken() && (await access.verify('access'))) {
        accessSub = access.getSubClaim();
      }
    } catch ( e ) {
      accessSub = '';
    }
    if (!accessSub || accessSub !== idSub) {
      log.warn('initiate rejected: access token invalid, or its subject does not match the authorized id token');
      return unauthenticated();
    }
    const sub = idSub;

    // mint a one-time challenge bound to this user, with a server-set creation time and short expiry.
    // the lifetime is passed to createChallengeSession, which derives the absolute ttl from the same
    // timestamp it stores as the challenge creation time (and bypasses the SESSION_TABLE_ITEM_TTL cap),
    // so the challenge lifetime is governed solely by STEP_UP_CHALLENGE_TTL
    const challengeTtlSeconds = readBoundedIntEnv(
      'STEP_UP_CHALLENGE_TTL', DEFAULT_CHALLENGE_TTL_SECONDS, MIN_CHALLENGE_TTL_SECONDS, MAX_CHALLENGE_TTL_SECONDS);
    const challengeId = crypto.randomBytes(16).toString('hex');
    try {
      const sessionClient = new SessionClient();
      await sessionClient.createChallengeSession(
        `challenge#${challengeId}`,
        sub,
        StepUpStatusEnum.STEP_UP_REQUIRED,
        challengeTtlSeconds,
      );
    } catch ( e: any ) {
      log.error(`unable to create step-up challenge - ${e?.name}: ${e?.message}`);
      return {
        statusCode: 500,
        headers: BASE_HEADERS,
        body: JSON.stringify({ code: 'CHALLENGE_CREATE_FAILED' }),
      };
    }

    return {
      statusCode: 200,
      headers: BASE_HEADERS,
      body: JSON.stringify({ code: 'REAUTH_REQUIRED', challengeId }),
    };
  }

  return {
    statusCode: 404,
    headers: BASE_HEADERS,
    body: JSON.stringify({ code: 'NOT_FOUND' }),
  };
};
