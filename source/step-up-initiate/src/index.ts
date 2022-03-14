// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  Context,
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  GetUserCommand,
  GetUserAttributeVerificationCodeCommand,
  GetUserCommandOutput,
  GetUserCommandInput,
} from '@aws-sdk/client-cognito-identity-provider';
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

/**
 * Step-up Auth Initiate API Proxy Lambda handler
 * @param event Lambda event object
 * @param context Lambda request context object
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  log.debug('event: ', JSON.stringify(event));
  log.debug('context ', JSON.stringify(context));

  if (event.path == '/initiate-auth' && event.httpMethod == 'OPTIONS') {
    return {
      statusCode: 200,
      headers: BASE_HEADERS,
      body: '{}',
    };
  }

  if (event.path == '/initiate-auth' && event.httpMethod == 'POST') {
    const authorizationHeader = event.headers['Authorization'];
    if (
      !authorizationHeader ||
      !/^Bearer [A-Za-z0-9-_=.]+$/.test(authorizationHeader)
    ) {
      return {
        statusCode: 401,
        headers: BASE_HEADERS,
        body: JSON.stringify({ code: 'UNAUTHENTICATED' }),
      };
    }

    const accessToken = authorizationHeader.substr(7);

    const client = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION ? process.env.AWS_REGION : 'us-east-1',
    });

    const params: GetUserCommandInput = { AccessToken: accessToken };
    const user: GetUserCommandOutput = await client.send(
      new GetUserCommand(params)
    );

    // dump user response
    log.debug(`user attributes: ${JSON.stringify(user)}`);

    let useSoftwareToken: boolean;

    if (user.PreferredMfaSetting === 'SOFTWARE_TOKEN_MFA') {
      useSoftwareToken = true;
    } else if (user.PreferredMfaSetting === 'SMS_MFA') {
      useSoftwareToken = false;
    } else if (
      user.UserMFASettingList &&
      user.UserMFASettingList.includes('SOFTWARE_TOKEN_MFA')
    ) {
      useSoftwareToken = true;
    } else if (
      user.UserMFASettingList &&
      user.UserMFASettingList.includes('SMS_MFA')
    ) {
      useSoftwareToken = false;
    } else if (
      user.UserAttributes &&
      user.UserAttributes.find(
        (attr) => attr.Name === 'phone_number_verified' && attr.Value === 'true'
      ) &&
      user.UserAttributes.find((attr) => attr.Name === 'phone_number')
    ) {
      useSoftwareToken = false;
    } else {
      return {
        statusCode: 200,
        headers: BASE_HEADERS,
        body: JSON.stringify({ code: 'MAYBE_SOFTWARE_TOKEN_STEP_UP' }),
      };
    }

    if (useSoftwareToken) {
      return {
        statusCode: 200,
        headers: BASE_HEADERS,
        body: JSON.stringify({ code: 'SOFTWARE_TOKEN_STEP_UP' }),
      };
    } else {
      try {
        await client.send(
          new GetUserAttributeVerificationCodeCommand({
            AccessToken: accessToken,
            AttributeName: 'phone_number',
          })
        );

        return {
          statusCode: 200,
          headers: BASE_HEADERS,
          body: JSON.stringify({ code: 'SMS_STEP_UP' }),
        };
      } catch ( e: any ) {
        log.error(`unable to invoke GetUserAttributeVerificationCodeCommand.  error details: ${JSON.stringify(e)}`);
        if (e.name && e.name === 'LimitExceededException') {
          return {
            statusCode: 429,
            headers: BASE_HEADERS,
            body: e.errorMessage ? e.errorMessage : `Cognito code verification limit exceeded. Slow Down! Wait ${e.$metadata.totalRetryDelay} seconds before retrying!`,
          };
        }

        // in all other cases, return bad request error
        return {
          statusCode: 400,
          headers: BASE_HEADERS,
          body: 'BAD REQUEST',
        };
      }
    }
  }

  return {
    statusCode: 404,
    headers: BASE_HEADERS,
    body: JSON.stringify({ code: 'NOT_FOUND' }),
  };
};
