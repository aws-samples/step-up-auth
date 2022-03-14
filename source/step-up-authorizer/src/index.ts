// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  Context,
  APIGatewayAuthorizerResultContext,
  APIGatewayRequestAuthorizerEvent,
  APIGatewayTokenAuthorizerEvent,
  APIGatewayAuthorizerWithContextResult } from 'aws-lambda';
import { Logger } from '@step-up-auth/auth-utils';
import { Authorizer } from './Authorizer';
import { RequestAuthorizer } from './RequestAuthorizer';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

/**
 * API Gateway Authorizer
 * @param {APIGatewayRequestAuthorizerEvent | APIGatewayTokenAuthorizerEvent} event request or token authorizer events
 * @param {Context} context API Gateway Authorizer context object
 * @returns {APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext>}
 */
export const handler = async (event: APIGatewayRequestAuthorizerEvent | APIGatewayTokenAuthorizerEvent, context: Context): Promise<APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext>> => {
  log.debug('event: ', JSON.stringify(event));
  log.debug('context: ', JSON.stringify(context));

  // capture authorizer type and methodArn
  const methodArn = event.methodArn;
  const type = event.type;

  if (event.type === 'REQUEST') {
    // if event and headers are not null, then process the event and return
    // policy based on event payload, i.e. cognito tokens and step-up claims
    // present within the tokens.
    if (event.headers) {
      const requestAuthorizer = new RequestAuthorizer(event, event.methodArn);
      return requestAuthorizer.generateResponseForEvent();
    }
    // if headers are missing in request authorizer, log a warning indicating
    // malformed headers and return allow policy
    else {
      log.warn('missing headers in request authorizer');
      const authorizer = new Authorizer(event.methodArn);
      return authorizer.generateAllowResponse();
    }
  }

  // all other types of authorizers are not supported, e.g. TOKEN authorizer.
  // Return a pass through / allow policy
  log.warn(`unsupported authorizer type: '${type}' with methodArn: '${methodArn}'`);
  const authorizer = new Authorizer(methodArn);
  return authorizer.generateAllowResponse();
};
