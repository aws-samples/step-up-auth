// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { StepUpStatusEnum } from '@step-up-auth/auth-sdk';
import { Logger } from '@step-up-auth/auth-utils';
import { ChallengeResponder } from './ChallengeResponder';
import {
  CognitoIdentityProviderClient,
  VerifySoftwareTokenCommand } from '@aws-sdk/client-cognito-identity-provider';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

/**
 * Software Token Challenge Responder base class
 */
class STChallengeResponder extends ChallengeResponder {

  /**
   * C-TOR
   * @param {string} token protected resource
   * @param {string} userResponse protected resource
   * @param {CognitoIdentityProviderClient} client protected resource
   */
  constructor(token: string, challengeResponse: string, client: CognitoIdentityProviderClient) {
    super(token, challengeResponse, client);
  }

  /**
   * Generate a response
   * @returns
   */
  public async validate(): Promise<boolean> {
    log.debug(`Software Token validate() called`);

    // Check if Challenge Response is valid
    if (!this.validateChallengeResponse() || !this.validateToken()){
      return false;
    }

    //If token and challenge response are valid, move on to validating the Software Token MFA data
    const params = {
      AccessToken: this.token,
      UserCode: this.challengeResponse
    };
    const command = new VerifySoftwareTokenCommand(params);
    try {
      const response = await this.client.send(command);
      if (response.Status?.includes('SUCCESS')){
        const ddbUpdateStatus = await this.updateSession(this.jtiClaim,StepUpStatusEnum.STEP_UP_COMPLETED);
        return ddbUpdateStatus;
      }
    } catch (error) {
      console.log(error);
      return false;
    }
    return false;
  }
}

export { STChallengeResponder };
