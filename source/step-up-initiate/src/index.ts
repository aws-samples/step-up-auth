// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  Context,
  APIGatewayProxyEvent,
  APIGatewayProxyEventHeaders,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { Logger } from '@step-up-auth/auth-utils';

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

/**
 * Step-up Auth Initiate API Proxy Lambda handler.
 *
 * Step-up is satisfied by a fresh re-authentication (see the respond-to-challenge function), so this
 * endpoint no longer inspects the user's MFA configuration or sends any code.  It simply tells the
 * client that it must re-authenticate by returning the `REAUTH_REQUIRED` code.  The client then
 * re-authenticates with Cognito (password plus the user's existing MFA) and calls
 * `/respond-to-challenge` with the freshly issued tokens.
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
    // the endpoint is additionally protected by the API Gateway Cognito authorizer (id token); here we
    // only sanity-check that an access token is present before telling the client to re-authenticate
    const authorizationHeader = getHeader(event.headers, 'Authorization');
    if (!authorizationHeader || !BEARER_RE.test(authorizationHeader)) {
      return {
        statusCode: 401,
        headers: BASE_HEADERS,
        body: JSON.stringify({ code: 'UNAUTHENTICATED' }),
      };
    }

    return {
      statusCode: 200,
      headers: BASE_HEADERS,
      body: JSON.stringify({ code: 'REAUTH_REQUIRED' }),
    };
  }

  return {
    statusCode: 404,
    headers: BASE_HEADERS,
    body: JSON.stringify({ code: 'NOT_FOUND' }),
  };
};
