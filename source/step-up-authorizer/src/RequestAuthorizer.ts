// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  APIGatewayRequestAuthorizerEvent,
  APIGatewayAuthorizerResultContext,
  APIGatewayAuthorizerWithContextResult,
  APIGatewayRequestAuthorizerEventHeaders } from 'aws-lambda';
import { Authorizer } from './Authorizer';
import {
  TokenHeaderNameEnum,
  TokenHeaderValueEnum } from './types';
import {
  CognitoToken,
  Logger } from '@step-up-auth/auth-utils';
import {
  SessionClient,
  SettingClient,
  Session,
  StepUpStatusEnum,
  StepUpStateEnum } from '@step-up-auth/auth-sdk';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

/**
 * Request Authorizer that triggers step-up authentication
 */
class RequestAuthorizer extends Authorizer {
  private event: APIGatewayRequestAuthorizerEvent;
  private authorizationHeader: string;
  private idTokenHeader: string;
  private clientId: string; // used when generating sessionId

  /**
   * C-TOR
   * @param {APIGatewayRequestAuthorizerEvent} event API Gateway Request Authorizer Event
   * @param {string} resource protected resource
   * @param {string} principalId user name
   */
  constructor(event: APIGatewayRequestAuthorizerEvent, resource: string, principalId?: string) {
    super(resource, principalId);

    this.event = event;
    this.clientId = '';
    this.idTokenHeader = TokenHeaderValueEnum.ID_TOKEN_HEADER_VALUE;
    this.authorizationHeader = TokenHeaderValueEnum.AUTHORIZATION_HEADER_VALUE;

    if (process.env[TokenHeaderNameEnum.ID_TOKEN_HEADER_NAME]) {
      this.idTokenHeader = process.env[TokenHeaderNameEnum.ID_TOKEN_HEADER_NAME]!;
    }

    if (process.env[TokenHeaderNameEnum.AUTHORIZATION_HEADER_NAME]) {
      this.authorizationHeader = process.env[TokenHeaderNameEnum.AUTHORIZATION_HEADER_NAME]!;
    }

    // convert headers to lower case
    this.idTokenHeader = this.idTokenHeader.toLowerCase();
    this.authorizationHeader = this.authorizationHeader.toLowerCase();
  }

  /**
   * Process API Gateway Request Authorizer event.
   * @returns {APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext>} API Gateway request authorizer response
   */
  public async generateResponseForEvent(): Promise<APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext>> {
    let headers = this.event.headers;

    // convert header's keys to lowercase.  API Gateway converts headers keys to small-case
    if (headers) {
      headers = Object.keys(headers)
        .reduce((updatedHeaders: APIGatewayRequestAuthorizerEventHeaders, key: string) => {
          updatedHeaders[key.toLowerCase()] = headers![key];
          return updatedHeaders;
        }, {});
    }

    // if headers is empty or authorization header is not set, return
    if (!headers || !headers[this.authorizationHeader]) {
      log.warn(`invalid access token or ${this.authorizationHeader} header not set`);
      // raising a runtime error with "Unauthorized" message signals Lambda Request Authorizer
      // to return HTTP 401 return code
      throw new Error("Unauthorized");
    }

    // check if access token is valid
    const accessToken: CognitoToken = new CognitoToken(headers[this.authorizationHeader]!);
    try {
      if (!accessToken.isAccessToken()) {
        log.warn('access token is invalid or not set');
        // return deny policy
        return this.generateDenyResponse();
      }

      // perform token validation.  return 403 if token is invalid
      const isValidToken = await this.isTokenValid(accessToken.getToken());
      if (!isValidToken) {
        log.warn(`access token is invalid.  token validation failed`);
        return this.generateDenyResponse();
      }

      // token validation successful, log a message and move to next step
      log.debug(`access token is valid.  token validation successful`);
    } catch ( e: any ) {
      log.warn(`invalid access token.  token validation failed.  error: ${e.message}`);
      return this.generateDenyResponse();
    }

    // extract jti and use it as sessionId in session table
    const sessionId = accessToken.getJtiClaim();

    // extract username claim from access token
    this.principalId = accessToken.getUsernameClaim();

    // extract clientId and token.  we store these values in session table when creating new session
    this.clientId = accessToken.getClientIdClaim();

    // check if sessionId exists in session
    // - if yes, then check for STATUS field
    //   - if STATUS == STEP_UP_COMPLETE then return 200
    //   - otherwise return 401
    // - if no, then
    //   - create new session using sessionId, return 401
    try {
      // look-up sessionId in 'session' and determine if step-up 'required' or 'completed'
      // if 'complete' return 200 and allow policy
      // otherwise return 401
      const client: SessionClient = new SessionClient();
      const retrievedSession: Session = await client.getSession(sessionId);

      if (retrievedSession) {
        log.debug(`retrieved session using sessionId: ${retrievedSession.sessionId} , step-up status: ${retrievedSession.stepUpStatus}`);

        switch (retrievedSession.stepUpStatus) {
          case StepUpStatusEnum.STEP_UP_REQUIRED:
            throw new Error("Unauthorized");

          case StepUpStatusEnum.STEP_UP_COMPLETED:
            return this.generateAllowResponse();

          case StepUpStatusEnum.STEP_UP_NOT_REQUIRED:
            return this.generateAllowResponse();

          default:
            return this.generateDenyResponse();
        }
      }
    } catch ( e: any ) {
      log.warn(`unable to retrieve request details for sessionId '${sessionId}'.  error: ${e.message}`);
    }

    // in all other cases, return rule based policy
    return this.generateAuthorizerResponseUsingSetting(this.event.path, sessionId);
  }


  /**
   * Generate API Gateway Request Authorizer response based auth-sdk setting table.
   * @param {string} api API path or API ARN to check in rules table
   * @param {string} sessionId session id to associate with new record in session table
   * @returns {APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext>} API Gateway request authorizer response
   */
  private async generateAuthorizerResponseUsingSetting(api: string, sessionId: string): Promise<APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext>> {
    log.debug('generateAuthorizerResponseUsingSetting() called');
    // check rule to determine if step-up is required for this api invocation, if yes
    //   return 401
    const client = new SettingClient();
    const retrievedStepUpStatus = await client.getStepUpStatus(api);
    log.debug(`generateAuthorizerResponseUsingSetting(): ${api} step-up status: ${retrievedStepUpStatus}`);

    // generate sessionId only when api has a rule with STEP_UP_REQUIRED in rule table
    if (retrievedStepUpStatus === StepUpStateEnum.STEP_UP_REQUIRED) {
      await this.createSession(sessionId);
      throw new Error("Unauthorized");
    }
    else if (retrievedStepUpStatus === StepUpStateEnum.STEP_UP_DENY) {
      return this.generateDenyResponse();
    }

    // in all other cases, return allow policy.
    return this.generateAllowResponse();
  }

  /**
   * Create a new session using auth-sdk
   * @returns {string} sessionId
   */
  private async createSession(sessionId: string): Promise<string> {
    // build referrerUrl.  we store it in session table
    const proto = this.hasProperty('X-Forwarded-Proto', this.event.headers);
    const domain = this.hasProperty('domainName', this.event.requestContext);
    const path = this.hasProperty('path', this.event.requestContext);
    let referrerUrl = '';

    if (proto.length === 0) {
      referrerUrl = `${domain}${path}`;
    }
    else if (domain.length > 0 && path.length > 0 ) {
      referrerUrl = `${proto}://${domain}${path}`;
    }

    // create a new session
    // note that clientId and token can be be empty strings. This happens when we
    // are performing step-up auth using `id token`, which doesn't contain these
    // values.
    const client = new SessionClient();
    const createdSessionId = await client.createSessionWithParams(sessionId, this.principalId, this.clientId, undefined, referrerUrl, StepUpStatusEnum.STEP_UP_REQUIRED);
    return createdSessionId;
  }

  /**
   * Return value for the key if key exists in object.  Return empty string otherwise
   * @param {string} key key
   * @param {object} obj object
   * @return {string} value represented by key if present, otherwise empty string
   */
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
  private hasProperty(key: string, obj: any): string {
    if (key in obj) {
      return obj[key];
    }
    return '';
  }

}

export { RequestAuthorizer };
