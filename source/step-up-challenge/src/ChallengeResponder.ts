// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {StepUpStatusEnum,
  SessionClient,
  Session} from '@step-up-auth/auth-sdk';
import {
  Logger,
  CognitoToken } from '@step-up-auth/auth-utils';
  import {
    CognitoIdentityProviderClient} from '@aws-sdk/client-cognito-identity-provider';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

/**
 * Challenge Responder base class
 */
class ChallengeResponder {
  protected token: string;
  protected challengeResponse: string;
  protected client: CognitoIdentityProviderClient;
  protected jtiClaim: string;

  /**
   * C-TOR
   * @param {string} token protected resource
   * @param {string} challengeResponse protected resource
   * @param {CognitoIdentityProviderClient} client protected resource
   */
  constructor(token: string, challengeResponse: string, client: CognitoIdentityProviderClient, jtiClaim?: string) {
    this.token = token;
    this.challengeResponse = challengeResponse;
    this.client=client;
    this.jtiClaim= jtiClaim || '';
  }

  /**
  * Generate a response
  * @returns
  */
  protected validateToken(): boolean {
    log.debug(`validateToken() called`);

    // check if access token is valid
    const accessToken: CognitoToken = new CognitoToken(this.token!);
    this.jtiClaim = accessToken.getJtiClaim();
    try {
      if (!accessToken.isAccessToken()) {
        log.warn('access token is invalid or not set');
        // return deny policy
        return false;
      }

      // perform token validation.
      const isValidToken = this.isTokenValid(accessToken.getToken());
      if (!isValidToken) {
        log.warn(`access token is invalid.  token validation failed`);
        return false;
      }

      // perform expiration time validation.
      const d1 = new Date();
      const d2 = new Date(accessToken.getExpClaim() * 1000);
      const validExpiration = d1.getTime() < d2.getTime();
      if (!validExpiration) {
        log.warn(`access token has expired.  token validation failed`);
        return false;
      }
      // token validation successful, log a message and move to next step
      log.debug(`access token is valid.  token validation successful`);
    } catch ( e: any ) {
      log.warn(`invalid access token.  token validation failed.  error: ${e.message}`);
      return false;
    }

    return true;
  }

  /**
   * Generate a response
   * @returns
   */
  protected validateChallengeResponse(): boolean {
    log.debug(`validateChallengeResponse() called`);
    // check if challenge response length is valid
    if (this.challengeResponse.length != 6) {
      log.warn('Challenge Response is Incorrect Length');
      // return invalid challenge response
      return false;
    }
    return true;
  }

  /**
   * Update DDB session table with new step-up status
   * @param {string} sessionId step-up session id
   * @param {string} newStatus new status code
   * @returns
   */
  protected async updateSession(sessionId: string, newStatus: StepUpStatusEnum): Promise<boolean> {
    log.debug(`updateSession() called. sessionId: ${sessionId} , newStatus: ${newStatus}`);
    //Create SessionClient
    const client: SessionClient = new SessionClient();
    //Get the current session entry in Dynamo
    const retrievedSession: Session = await client.getSession(sessionId);
    if (retrievedSession) {
      //Update the status value of the current session entry
      retrievedSession.stepUpStatus=newStatus;
      const now = new Date();
      //Update the session entry in Dynamo
      client.updateSession(retrievedSession,now.toISOString());
    } else {
      console.log(`Issue updating Session Table - Record Missing.`);
      return false;
    }
    return true;
  }

  /**
   * Validate token
   * @param {string} token JWT - typically access token
   * @returns {boolean} true or false depending on if token is valid
   */
  private async isTokenValid(token: string): Promise<boolean> {
    const cognitoToken = new CognitoToken(token);
    const result = cognitoToken.verify();
    log.debug(`token verification result: ${result}`);
    return result;
  }
}

export { ChallengeResponder };
