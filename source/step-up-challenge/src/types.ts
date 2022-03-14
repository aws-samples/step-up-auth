// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { APIGatewayProxyResult } from 'aws-lambda';

/**
 * Error object
 */
export interface Error {
  code: number;
  message: string;
  type: string;
  caused: string;
}
/**
 * Info object
 */
export interface Info {
  name: string;
  details: string;
}
/**
 * Extend APIGatewayProxyResult but omit the body property so that we can define
 * our own with multi valued type.  Omit to the rescue!
 */
export interface APIGatewaySampleProxyResult extends Omit<APIGatewayProxyResult, 'body'>  {
  body : string | Info | Error;
}
/**
 * Step Up MFA Challenge Types
 */
export enum ChallengeTypesEnum {
  /* eslint-disable no-unused-vars */
  SMS_STEP_UP = 'SMS_STEP_UP',
  SOFTWARE_TOKEN_STEP_UP = 'SOFTWARE_TOKEN_STEP_UP',
  MAYBE_SOFTWARE_TOKEN_STEP_UP = 'MAYBE_SOFTWARE_TOKEN_STEP_UP'
  /* eslint-enable no-unused-vars */
}
