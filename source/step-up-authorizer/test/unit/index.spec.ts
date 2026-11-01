// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, afterEach, jest } from '@jest/globals';
import { APIGatewayRequestAuthorizerEvent, APIGatewayTokenAuthorizerEvent } from 'aws-lambda';
import { RequestAuthorizer } from '../../src/RequestAuthorizer';
import { Authorizer } from '../../src/Authorizer';
import * as index  from '../../src/index';
import * as mocks from '../mocks/mocks';

// clone the shared mock events so a test cannot leak changes into another test
const requestEvent = (): APIGatewayRequestAuthorizerEvent => JSON.parse(JSON.stringify(mocks.requestAuthorizerEvent));
const tokenEvent = (): APIGatewayTokenAuthorizerEvent => JSON.parse(JSON.stringify(mocks.tokenAuthorizerEvent));

describe('index test suite', () => {

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns policy document for REQUEST authorizer', async () => {
    // setup mocks
    const requestAuthorizerSpy = jest.spyOn(RequestAuthorizer.prototype, 'generateResponseForEvent');
    requestAuthorizerSpy.mockResolvedValueOnce(mocks.authorizerResultWithAlow);

    // make call with mocked RequestAuthorizer
    const response = await index.handler(requestEvent(), mocks.authorizerContext);

    // assert
    expect(response.policyDocument).not.toBeNull();
    expect(requestAuthorizerSpy).toHaveBeenCalledTimes(1);
    expect(response.policyDocument.Statement[0].Effect).toBe('Allow');
  });

  it('rejects with Unauthorized (401) for REQUEST authorizer with missing headers', async () => {
    // setup mocks
    const requestAuthorizerSpy = jest.spyOn(RequestAuthorizer.prototype, 'generateResponseForEvent');
    const allowSpy = jest.spyOn(Authorizer.prototype, 'generateAllowResponse');

    const event = requestEvent();
    event.headers = null;

    // assert
    await expect(index.handler(event, mocks.authorizerContext)).rejects.toThrow('Unauthorized');
    expect(requestAuthorizerSpy).not.toHaveBeenCalled();
    expect(allowSpy).not.toHaveBeenCalled();
  });

  it('returns a deny policy for TOKEN authorizer', async () => {
    // setup mocks
    const allowSpy = jest.spyOn(Authorizer.prototype, 'generateAllowResponse');

    // We don't have a Token Authorizer implementation, so the handler denies
    const response = await index.handler(tokenEvent(), mocks.authorizerContext);

    // assert
    expect(response.policyDocument).not.toBeNull();
    expect(allowSpy).not.toHaveBeenCalled();
    expect(response.policyDocument.Statement[0].Effect).toBe('Deny');
  });

});
