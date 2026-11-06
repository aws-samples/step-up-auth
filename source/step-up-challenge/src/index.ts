// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  Context,
  APIGatewayProxyEvent,
  APIGatewayProxyEventHeaders,
  APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@step-up-auth/auth-utils';
import { Error, Info } from './types';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { ReauthStepUpResponder } from './ReauthStepUpResponder';

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

/** Extract the raw token from a `Bearer <token>` header value, or undefined if malformed/absent. */
const bearerToken = (headerValue: string | undefined): string | undefined => {
  if (!headerValue || !BEARER_RE.test(headerValue)) {
    return undefined;
  }
  return headerValue.substring(7);
};

/**
 * Step-up Auth Challenge API Proxy Lambda handler.
 *
 * Step-up is completed by a *fresh re-authentication* that was prompted by this step-up request, not by
 * verifying or enrolling an MFA factor.  The client re-authenticates with Cognito (password plus the
 * user's existing MFA) and calls this endpoint presenting the freshly issued tokens (access token in the
 * `Authorization` header, id token in the `Identification` header) and the one-time `challengeId` from
 * `/initiate-auth` in the JSON request body.  See `ReauthStepUpResponder` for the checks that must pass.
 * @param event Lambda event object
 * @param context Lambda request context object
 */
export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  log.debug('event: ', JSON.stringify(Logger.sanitizeEvent(event)));
  log.debug('request id: ', context?.awsRequestId);

  const result: APIGatewayProxyResult = <APIGatewayProxyResult>{};
  result.headers = BASE_HEADERS;
  const info: Info = <Info> {};
  info.name = 'Status';

  if (event.path === '/respond-to-challenge' && event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: BASE_HEADERS, body: '{}' };
  }

  if (event.path === '/respond-to-challenge' && event.httpMethod === 'POST') {
    // the fresh access token (Authorization) and fresh id token (Identification) are the step-up proof
    const accessToken = bearerToken(getHeader(event.headers, 'Authorization'));
    const idToken = bearerToken(getHeader(event.headers, 'Identification'));
    if (!accessToken || !idToken) {
      log.warn('missing or malformed Authorization/Identification token');
      result.statusCode = 401;
      result.body = JSON.stringify({ code: 'UNAUTHENTICATED' });
      return result;
    }

    // the one-time challenge id from /initiate-auth is sent in the JSON body; a missing/invalid body
    // simply yields no challenge id, which the responder rejects (fail closed)
    let challengeId: string | undefined;
    try {
      const parsed = event.body ? JSON.parse(event.body) : {};
      if (parsed && typeof parsed.challengeId === 'string') {
        challengeId = parsed.challengeId;
      }
    } catch ( e ) {
      log.warn('unable to parse request body for challengeId');
    }

    const client = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION ? process.env.AWS_REGION : 'us-east-1',
    });

    const responder = new ReauthStepUpResponder(accessToken, idToken, client, challengeId);
    const outcome = await responder.validate();

    if (outcome.ok) {
      info.details = 'Step-up complete';
      result.statusCode = 200;
      result.body = JSON.stringify(info);
      return result;
    }

    info.details = 'Step-up failed';
    result.statusCode = 401;
    result.body = JSON.stringify({ ...info, reason: outcome.reason });
    return result;
  }

  // in all other cases return a generic fault
  const error: Error = <Error> {};
  error.code = 1;
  error.message = 'unhandled request';
  error.type = 'request';
  error.caused = 'handler';
  result.body = JSON.stringify(error);
  result.statusCode = 400;
  return result;
};
