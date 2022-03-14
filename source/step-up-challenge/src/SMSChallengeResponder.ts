// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { StepUpStatusEnum } from '@step-up-auth/auth-sdk';
import { Logger } from '@step-up-auth/auth-utils';
import { ChallengeResponder } from './ChallengeResponder';
import {
  CognitoIdentityProviderClient,
  VerifyUserAttributeCommand } from '@aws-sdk/client-cognito-identity-provider';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

/**
 * SMS Challenge Responder base class
 */
class SMSChallengeResponder extends ChallengeResponder {

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
    log.debug(`SMS validate() called`);

    // Check if Challenge Response is valid
    if (!this.validateChallengeResponse() || !this.validateToken()){
      return false;
    }

    //If token and challenge response are valid, move on to validating the SMS MFA data
    const params = {
      AccessToken: this.token,
      AttributeName: 'phone_number',
      Code: this.challengeResponse
    };
    const command = new VerifyUserAttributeCommand(params);
    try {
      const response = await this.client.send(command);
      if (response.$metadata.httpStatusCode === 200){
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

export { SMSChallengeResponder };
