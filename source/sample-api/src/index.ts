// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  Context,
  APIGatewayProxyEvent,
  APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@step-up-auth/auth-utils';
import { APIGatewaySampleProxyResult, Error, Info } from './types';

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
 * Sample API Gateway Proxy Lambda handler
 * @param event Lambda event object
 * @param context Lambda request context object
 */
export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewaySampleProxyResult> => {
  log.debug('event: ', JSON.stringify(event));
  log.debug('context ', JSON.stringify(context));

  // perform preflight checks - guard against missing path and http method.
  // this is optional and unnecessary for bootstrap because bootstrap takes
  // care of event objects
  if (!event.path || !event.httpMethod) {
    // return error
    const error: Error = <Error> {};
    error.code = 1;
    error.message = 'incorrect path or method';
    error.type = 'request';
    error.caused = 'handler';

    const result: APIGatewayProxyResult = <APIGatewayProxyResult>{};
    result.headers = BASE_HEADERS;
    result.body = JSON.stringify(error);
    result.statusCode = 400;
    log.debug('returning result: ' + JSON.stringify(result));
    return result;
  }

  // sample business logic.
  if (event.path === '/info' && event.httpMethod === 'GET') {
    // create dummy info
    const now = new Date();
    const info: Info = <Info> {};
    info.name = 'info';
    info.details = 'info generated on ' + now.toISOString();

    // send api response with info
    const result: APIGatewayProxyResult = <APIGatewayProxyResult>{};
    result.headers = BASE_HEADERS;
    result.body = JSON.stringify(info);
    result.statusCode = 200;
    log.debug('returning result: ' + JSON.stringify(result));
    return result;
  }
  else if (event.path === '/transfer' && event.httpMethod === 'POST') {
    // send api response with info
    const result: APIGatewayProxyResult = <APIGatewayProxyResult>{};
    result.headers = BASE_HEADERS;
    result.body = 'dummy /transfer successful';
    result.statusCode = 200;
    log.debug('returning result: ' + JSON.stringify(result));
    return result;
  }
  // more api paths here


  // in all other cases return results generic fault
  const error: Error = <Error> {};
  error.code = 1;
  error.message = 'unhandled request';
  error.type = 'request';
  error.caused = 'handler';

  const result: APIGatewayProxyResult = <APIGatewayProxyResult>{};
  result.headers = BASE_HEADERS;
  result.body = JSON.stringify(error);
  result.statusCode = 400;
  console.log('returning result: ' + JSON.stringify(result));

  return result;
};
