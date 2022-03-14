// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, afterEach, jest } from '@jest/globals';
import { RequestAuthorizer } from '../../src/RequestAuthorizer';
import { Authorizer } from '../../src/Authorizer';
import * as index  from '../../src/index';
import * as mocks from '../mocks/mocks';

describe('index test suite', () => {

  afterEach(() => {
    jest.resetAllMocks();
    jest.restoreAllMocks();
  });

  it('returns policy document for REQUEST authorizer', async () => {
    // setup mocks
    const requestAuthorizerSpy = jest.spyOn(RequestAuthorizer.prototype, 'generateResponseForEvent');
    requestAuthorizerSpy.mockReturnValueOnce(Promise.resolve(mocks.authorizerResultWithAlow));

    // values to test
    const allowEffect = 'Allow';

    // make call with mocked RequestAuthorizer
    const response = await index.handler(mocks.requestAuthorizerEvent, mocks.authorizerContext);

    // assert
    expect(response.policyDocument).not.toBeNull();
    expect(RequestAuthorizer.prototype.generateResponseForEvent).toHaveBeenCalledTimes(1);
    expect(response.policyDocument.Statement[0].Effect).toEqual(allowEffect);

    // reset mocks
    requestAuthorizerSpy.mockRestore();
  });

  it('returns policy document for REQUEST authorizer with missing headers', async () => {
    // setup mocks
    const requestAuthorizerSpy = jest.spyOn(RequestAuthorizer.prototype, 'generateResponseForEvent');
    requestAuthorizerSpy.mockReturnValueOnce(Promise.resolve(mocks.authorizerResultWithAlow));
    const authorizerSpy = jest.spyOn(Authorizer.prototype, 'generateAllowResponse');
    authorizerSpy.mockReturnValueOnce(mocks.authorizerResultWithAlow);

    // values to test
    const allowEffect = 'Allow';

    // make call with mocked RequestAuthorizer
    mocks.requestAuthorizerEvent.headers = null;
    const response = await index.handler(mocks.requestAuthorizerEvent, mocks.authorizerContext);

    // assert
    expect(response.policyDocument).not.toBeNull();
    expect(RequestAuthorizer.prototype.generateResponseForEvent).toHaveBeenCalledTimes(0);
    expect(Authorizer.prototype.generateAllowResponse).toHaveBeenCalledTimes(1);
    expect(response.policyDocument.Statement[0].Effect).toEqual(allowEffect);

    // reset mocks
    requestAuthorizerSpy.mockRestore();
    authorizerSpy.mockRestore();
  });

  it('returns policy document for TOKEN authorizer', async () => {
    // setup mocks
    const authorizerSpy = jest.spyOn(Authorizer.prototype, 'generateAllowResponse');
    authorizerSpy.mockReturnValueOnce(mocks.authorizerResultWithAlow);

    // values to test
    const allowEffect = 'Allow';

    // make call with mocked Authorizer.  We don't have a Token Authorizer
    // implementation so we use base Authorizer
    const response = await index.handler(mocks.tokenAuthorizerEvent, mocks.authorizerContext);

    // assert
    expect(response.policyDocument).not.toBeNull();
    expect(Authorizer.prototype.generateAllowResponse).toHaveBeenCalledTimes(1); // twice because we invoke Authorizer in previous test with null headers
    expect(response.policyDocument.Statement[0].Effect).toEqual(allowEffect);

    // reset mocks
    authorizerSpy.mockRestore();
  });

});
