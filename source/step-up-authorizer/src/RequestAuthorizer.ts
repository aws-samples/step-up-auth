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
  StepUpStateEnum,
  RecordNotFoundException } from '@step-up-auth/auth-sdk';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

/**
 * Request Authorizer that triggers step-up authentication
 */
class RequestAuthorizer extends Authorizer {
  private event: APIGatewayRequestAuthorizerEvent;
  private headers: APIGatewayRequestAuthorizerEventHeaders; // request headers with lowercase names
  private authorizationHeader: string;
  private idTokenHeader: string;
  private clientId: string; // used when generating sessionId
  private tokenExp: number; // access token `exp` claim.  caps the session ttl

  /**
   * C-TOR
   * @param {APIGatewayRequestAuthorizerEvent} event API Gateway Request Authorizer Event
   * @param {string} resource protected resource
   * @param {string} principalId user name
   */
  constructor(event: APIGatewayRequestAuthorizerEvent, resource: string, principalId?: string) {
    super(resource, principalId);

    this.event = event;
    this.headers = {};
    this.clientId = '';
    this.tokenExp = 0;
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
    // convert header names to lowercase (HTTP header names are case-insensitive, and clients send them
    // in either case).  every header read below uses this map
    const eventHeaders = this.event.headers;
    if (eventHeaders) {
      this.headers = Object.keys(eventHeaders)
        .reduce((updatedHeaders: APIGatewayRequestAuthorizerEventHeaders, key: string) => {
          updatedHeaders[key.toLowerCase()] = eventHeaders[key];
          return updatedHeaders;
        }, {});
    }
    const headers = this.headers;

    // if headers is empty or authorization header is not set, return
    if (!eventHeaders || !headers[this.authorizationHeader]) {
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
    // extract token expiry.  a new session's ttl never exceeds it
    this.tokenExp = accessToken.getExpClaim();

    // the api setting is keyed by the API Gateway resource path of the method being authorized (for
    // example /transfer), not by the raw request path, so a variant of the request path can never miss
    // the setting row.  without a resource path, deny
    const api = this.getResourcePath();
    if (!api) {
      log.warn('request has no API Gateway resource path.  denying access');
      return this.generateDenyResponse();
    }

    // the api setting decides first, so that STEP_UP_DENY applies even when the
    // caller has a completed step-up session
    // - STEP_UP_DENY: return deny policy (403)
    // - STEP_UP_NOT_REQUIRED or no setting: return allow policy without touching the session table
    // - STEP_UP_REQUIRED: check the step-up session (see generateResponseUsingSession())
    // - setting can't be read: return deny policy (403)
    let stepUpState: StepUpStateEnum;
    try {
      const settingClient = new SettingClient();
      stepUpState = await settingClient.getStepUpStatus(api);
    } catch ( e: any ) {
      log.error(`unable to read setting for api '${api}'.  denying access.  error: ${e.message}`);
      return this.generateDenyResponse();
    }
    log.debug(`api ${api} step-up state: ${stepUpState}`);

    switch (stepUpState) {
      case StepUpStateEnum.STEP_UP_NOT_REQUIRED:
        return this.generateAllowResponse();

      case StepUpStateEnum.STEP_UP_REQUIRED:
        return this.generateResponseUsingSession(sessionId);

      case StepUpStateEnum.STEP_UP_DENY:
      default:
        return this.generateDenyResponse();
    }
  }


  /**
   * Generate API Gateway Request Authorizer response for an api that requires step-up, based on
   * the caller's step-up session in auth-sdk session table.
   * - a STEP_UP_COMPLETED session whose ttl is in the future: return allow policy
   * - no session, an expired or missing ttl, or any other step-up status: create a new
   *   STEP_UP_REQUIRED session and return 401
   * - session can't be read, or the new session can't be written: return deny policy (403)
   * @param {string} sessionId session id (access token jti) to look up, and to use for a new session
   * @returns {APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext>} API Gateway request authorizer response
   */
  private async generateResponseUsingSession(sessionId: string): Promise<APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext>> {
    log.debug('generateResponseUsingSession() called');
    let retrievedSession: Session | undefined;
    try {
      const client: SessionClient = new SessionClient();
      retrievedSession = await client.getSession(sessionId);
    } catch ( e: any ) {
      if (!(e instanceof RecordNotFoundException)) {
        // read error (e.g. DynamoDB or IAM failure), as opposed to "no session": fail closed
        log.error(`unable to read session '${sessionId}'.  denying access.  error: ${e.message}`);
        return this.generateDenyResponse();
      }
      log.debug(`no session found for sessionId '${sessionId}'`);
    }

    if (retrievedSession) {
      log.debug(`retrieved session using sessionId: ${retrievedSession.sessionId} , step-up status: ${retrievedSession.stepUpStatus}`);

      // DynamoDB deletes expired items lazily, so check the ttl here
      const nowInSeconds = Math.floor(Date.now() / 1000);
      if (retrievedSession.stepUpStatus === StepUpStatusEnum.STEP_UP_COMPLETED &&
          retrievedSession.ttl && retrievedSession.ttl > nowInSeconds) {
        return this.generateAllowResponse();
      }
      log.warn(`session '${sessionId}' with step-up status ${retrievedSession.stepUpStatus} (ttl: ${retrievedSession.ttl}) does not allow access.  starting a new step-up challenge`);
    }

    // no session, an expired session or a session that has not completed step-up:
    // create a new STEP_UP_REQUIRED session and return 401
    try {
      await this.createSession(sessionId);
    } catch ( e: any ) {
      // write error (e.g. DynamoDB or IAM failure): deny explicitly rather than fail with a 500
      log.error(`unable to create step-up session '${sessionId}'.  denying access.  error: ${e.message}`);
      return this.generateDenyResponse();
    }
    throw new Error("Unauthorized");
  }

  /**
   * API Gateway resource path of the method being authorized, for example `/transfer`: the `resource`
   * of the event, else `requestContext.resourcePath`.  Unlike the request path, it is the path of the
   * API Gateway resource whose method the allow policy (methodArn) grants.
   * @returns {string} resource path, or empty string when the event carries none
   */
  private getResourcePath(): string {
    const resource = this.stringProperty('resource', this.event);
    if (resource.length > 0) {
      return resource;
    }
    return this.stringProperty('resourcePath', this.event.requestContext);
  }

  /**
   * Create a new session using auth-sdk
   * @returns {string} sessionId
   */
  private async createSession(sessionId: string): Promise<string> {
    // build referrerUrl.  we store it in session table.  the header is read from the lowercase map
    const proto = this.stringProperty('x-forwarded-proto', this.headers);
    const domain = this.stringProperty('domainName', this.event.requestContext);
    const path = this.stringProperty('path', this.event.requestContext);
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
    const createdSessionId = await client.createSessionWithParams(sessionId, this.principalId, this.clientId, undefined, referrerUrl, StepUpStatusEnum.STEP_UP_REQUIRED, this.tokenExp);
    return createdSessionId;
  }

  /**
   * Return the value for the key if the object has it and it is a string.  Return empty string otherwise
   * @param {string} key key
   * @param {object} obj object, may be null or undefined
   * @return {string} string value represented by key if present, otherwise empty string
   */
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
  private stringProperty(key: string, obj: any): string {
    if (obj && typeof obj === 'object' && typeof obj[key] === 'string') {
      return obj[key];
    }
    return '';
  }

}

export { RequestAuthorizer };
