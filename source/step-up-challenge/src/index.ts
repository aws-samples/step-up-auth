// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  Context,
  APIGatewayProxyEvent,
  APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@step-up-auth/auth-utils';
import { Error, Info } from './types';
import { ChallengeTypesEnum } from './types';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SMSChallengeResponder } from './SMSChallengeResponder';
import { STChallengeResponder } from './STChallengeResponder';

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
 * Step-up Auth Challenge API Proxy Lambda handler
 * @param event Lambda event object
 * @param context Lambda request context object
 */
export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  log.debug('event: ', JSON.stringify(event));
  log.debug('context ', JSON.stringify(context));

  // build api response with info
  const result: APIGatewayProxyResult = <APIGatewayProxyResult>{};
  result.headers = BASE_HEADERS;
  const info: Info = <Info> {};
  info.name = 'Status';

  if (event.path == '/respond-to-challenge' && event.httpMethod == 'OPTIONS') {
    return {
      statusCode: 200,
      headers: BASE_HEADERS,
      body: '{}',
    };
  }

  if (event.path === '/respond-to-challenge' && event.httpMethod === 'POST') {
    //Get Authorization Header
    let authorizationHeader = '';
    if (event.headers && event.headers['Authorization']) {
      authorizationHeader = event.headers['Authorization'];
      if (
        !authorizationHeader ||
        !/^Bearer [A-Za-z0-9-_=.]+$/.test(authorizationHeader)
      ) {
        result.statusCode = 401;
        result.body = JSON.stringify({ code: 'UNAUTHENTICATED' });
        return result;
      }
    } else {
      {
        result.statusCode = 401;
        result.body = JSON.stringify({ code: 'UNAUTHENTICATED' });
        return result;
      }
    }

    const accessToken = authorizationHeader.substr(7);

    const client = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION ? process.env.AWS_REGION : 'us-east-1',
    });

    if (event.body){
      const body = JSON.parse(event.body);
      if (body['step-up-type'] === ChallengeTypesEnum.SMS_STEP_UP && body['challenge-response']){
        //Validate challenge via VerifyUserAttributeCommand
        const smsChallengeResponder = new SMSChallengeResponder(accessToken, body['challenge-response'], client);
        const challengeCompleted = await smsChallengeResponder.validate();
        if (challengeCompleted){
          info.details = 'Challenge Successful';
          result.body = JSON.stringify(info);
          result.statusCode = 200;
          return result;
        } else {
          info.details = 'Challenge Failed - Code Mismatch or Expired Code';
          result.body = JSON.stringify(info);
          result.statusCode = 401;
          return result;
        }
      } else if (
        (
          body['step-up-type'] === ChallengeTypesEnum.SOFTWARE_TOKEN_STEP_UP ||
          body['step-up-type'] === ChallengeTypesEnum.MAYBE_SOFTWARE_TOKEN_STEP_UP
        ) && body['challenge-response']) {
        //Validate challenge via VerifySoftwareTokenCommand
        const stChallengeResponder = new STChallengeResponder(accessToken, body['challenge-response'], client);
        const challengeCompleted = await stChallengeResponder.validate();
        if (challengeCompleted){
          info.details = 'Challenge Successful';
          result.body = JSON.stringify(info);
          result.statusCode = 200;
          return result;
        } else {
          info.details = 'Challenge Failed - Code Mismatch or Expired Code';
          result.body = JSON.stringify(info);
          result.statusCode = 401;
          return result;
        }
      } else {
        log.warn('missing required keys in body of request');
        info.details = 'Challenge Failed - Check Keys in Body of Request';
        result.body = JSON.stringify(info);
        result.statusCode = 400;
        return result;
      }
    } else { //If headers exist but the body is missing, we are unable to determine the step up type, so challenge fails
      log.warn('missing body in request');
      info.details = 'Challenge Failed - Check Body';
      result.body = JSON.stringify(info);
      result.statusCode = 400;
      return result;
    }
  }

  // in all other cases return results generic fault
  const error: Error = <Error> {};
  error.code = 1;
  error.message = 'unhandled request';
  error.type = 'request';
  error.caused = 'handler';

  result.body = JSON.stringify(error);
  result.statusCode = 400;
  console.log('returning result: ' + JSON.stringify(result));

  return result;
};
