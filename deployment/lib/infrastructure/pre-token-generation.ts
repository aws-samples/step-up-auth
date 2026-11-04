// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The scope that the pre token generation trigger removes from every access token the user pool issues.
 *
 * `aws.cognito.signin.user.admin` authorizes the token-authorized user pool operations that let a user
 * manage their own profile: GetUser, UpdateUserAttributes, SetUserMFAPreference, AssociateSoftwareToken,
 * VerifySoftwareToken and the rest.  With it, a stolen browser access token could disable MFA or
 * register the attacker's own authenticator before a step-up re-authentication.  Without it, the
 * token can no longer call those operations.
 */
export const SUPPRESSED_ACCESS_TOKEN_SCOPE = 'aws.cognito.signin.user.admin';

/**
 * Source of the pre token generation Lambda trigger (event version V2_0), deployed inline on the user
 * pool.
 *
 * The handler sets `response.claimsAndScopeOverrideDetails.accessTokenGeneration.scopesToSuppress` to
 * the scope above, the event version two shape documented in "Pre token generation Lambda trigger" in
 * the Amazon Cognito Developer Guide:
 * https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html
 *
 * It suppresses unconditionally and reads nothing from the event, so every token-issuing path gets the
 * same treatment: sign-in, the step-up re-authentication, a new-password challenge and a refresh
 * (`TokenGeneration_RefreshTokens`).  It logs nothing, so no user attribute reaches CloudWatch.  If the
 * function fails, Cognito issues no tokens: the trigger fails closed.
 */
export const PRE_TOKEN_GENERATION_HANDLER = `'use strict';
// Removes ${SUPPRESSED_ACCESS_TOKEN_SCOPE} from every access token, unconditionally.
// Event version two response shape, see "Pre token generation Lambda trigger" in the Amazon Cognito
// Developer Guide: https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html
exports.handler = async (event) => {
  event.response = {
    claimsAndScopeOverrideDetails: {
      accessTokenGeneration: {
        scopesToSuppress: [${JSON.stringify(SUPPRESSED_ACCESS_TOKEN_SCOPE)}]
      }
    }
  };
  return event;
};
`;
