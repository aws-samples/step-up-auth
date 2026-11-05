// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Logger } from '@step-up-auth/auth-utils';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

/** Shape of a Cognito user pool id: `<region>_<id>`, for example `us-east-1_AbCdEf123`. */
const USER_POOL_ID_RE = /^[a-z]{2}(-[a-z]+)+-\d_[0-9A-Za-z]+$/;

/**
 * Read the user pool id that the step-up MFA check (AdminGetUser and GetUserPoolMfaConfig) runs against.
 *
 * It reads the USER_POOL_ID env var and accepts it only when it has the shape of a user pool id and, when
 * COGNITO_USER_POOL_ARN is also set, names the same pool as that ARN (the pool the tokens are verified
 * against).  Otherwise it returns undefined, so the caller fails closed.  The warning names the variable
 * only and never echoes the supplied value.
 * @returns {string | undefined} the configured user pool id, or undefined when it is missing or invalid
 */
export function configuredUserPoolId(): string | undefined {
  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId || !USER_POOL_ID_RE.test(userPoolId)) {
    log.warn('USER_POOL_ID is not set or is not a valid user pool id');
    return undefined;
  }
  const userPoolArn = process.env.COGNITO_USER_POOL_ARN;
  if (userPoolArn && userPoolArn.substring(userPoolArn.lastIndexOf('/') + 1) !== userPoolId) {
    log.warn('USER_POOL_ID does not name the user pool in COGNITO_USER_POOL_ARN');
    return undefined;
  }
  return userPoolId;
}
