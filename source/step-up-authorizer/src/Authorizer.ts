// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  APIGatewayAuthorizerResultContext,
  APIGatewayAuthorizerWithContextResult } from 'aws-lambda';
import { AuthClaimEnum, StepUpClaimEnum } from '@step-up-auth/auth-sdk';
import {
  Logger,
  CognitoToken } from '@step-up-auth/auth-utils';
import { Policy } from './Policy';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

/**
 * API Gateway Authorizer base class
 */
class Authorizer {
  protected principalId: string;
  protected resource: string;

  /**
   * C-TOR
   * @param {string} resource protected resource
   * @param {string} principalId optional principal id or user name
   */
  constructor(resource: string, principalId?: string) {
    this.resource = resource;
    this.principalId = principalId || '';
  }

  /**
   * Generate a response based on policy document, setup-up status and request id
   * @param {Policy} policy policy document
   * @param {string} stepUpStatus stepup status
   * @param {string} sessionId step-up session id
   * @returns
   */
  protected generateResponse(policy: Policy, stepUpStatus?: string, sessionId?: string): APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext> {
    log.debug(`generateResponse() called. policy: ${JSON.stringify(policy)} , stepUpStatus: ${stepUpStatus} , sessionId: ${sessionId}`);
    // create a 200 response
    const authorizerContext: APIGatewayAuthorizerResultContext = <APIGatewayAuthorizerResultContext> {};
    stepUpStatus ?
      authorizerContext[AuthClaimEnum.STEP_UP_CLAIM] = stepUpStatus :
      authorizerContext[AuthClaimEnum.STEP_UP_CLAIM] = StepUpClaimEnum.STEP_UP_NOT_REQUIRED;
    sessionId ?
      authorizerContext[AuthClaimEnum.SESSION_ID_CLAIM] = sessionId :
      authorizerContext[AuthClaimEnum.SESSION_ID_CLAIM] = '';

    const response = <APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext>>{};
    if (this.principalId) {
      response.principalId = this.principalId;
    }
    response.policyDocument = policy.getPolicy();
    response.context = authorizerContext;

    log.debug(`generateResponse(): returning policy ${JSON.stringify(response)}`);
    return response;
  }

  /**
   * Convenience method that invokes `generateResponse()` to generate a `Allow` API Gateway Authorizer policy
   * @param {string} stepUpStatus step-up status
   * @param {string} sessionId step-up session id
   * @returns {APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext>} API Gateway Authorizer Response object containing context information
   */
  public generateAllowResponse(stepUpStatus?: string, sessionId?: string): APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext> {
    // generate allow policy
    const policy: Policy = new Policy('Allow', this.resource);
    return this.generateResponse(policy, stepUpStatus, sessionId);
  }

  /**
   * Convenience method that invokes `generateResponse()` to generate a `Deny` API Gateway Authorizer policy
   * @param {string} stepUpStatus step-up status
   * @param {string} sessionId step-up session id
   * @returns {APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext>} API Gateway Authorizer Response object containing context information
   */
  public generateDenyResponse(stepUpStatus?: string, sessionId?: string): APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext> {
    // generate  policy
    const policy: Policy = new Policy('Deny', this.resource);
    return this.generateResponse(policy, stepUpStatus, sessionId);
  }

  /**
   * Validate token
   * @param {string} token JWT - typically access token
   * @returns {boolean} true or false depending on if token is valid
   */
  public async isTokenValid(token: string): Promise<boolean> {
    const cognitoToken = new CognitoToken(token);
    const result = cognitoToken.verify();
    log.debug(`token verification result: ${result}`);
    return result;
  }
}

export { Authorizer };
