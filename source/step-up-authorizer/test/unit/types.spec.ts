// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from '@jest/globals';
import { TokenHeaderNameEnum, TokenHeaderValueEnum } from '../../src/types';

describe('Token Enum test suite', () => {
  it('Token header environment variable name expected value', async () => {
    // value to test
    const idTokenHeaderName = 'ID_TOKEN_HEADER';
    const authorizationTokenHeaderName = 'AUTHORIZATION_HEADER';
    expect(TokenHeaderNameEnum.ID_TOKEN_HEADER_NAME).toEqual(idTokenHeaderName);
    expect(TokenHeaderNameEnum.AUTHORIZATION_HEADER_NAME).toEqual(authorizationTokenHeaderName);
  });

  it('Token header environment variable value enumeration returns expected value', async () => {
    // value to test
    const idTokenHeaderValue = 'identification';
    const authorizationTokenHeaderValue = 'Authorization';
    expect(TokenHeaderValueEnum.ID_TOKEN_HEADER_VALUE).toEqual(idTokenHeaderValue);
    expect(TokenHeaderValueEnum.AUTHORIZATION_HEADER_VALUE).toEqual(authorizationTokenHeaderValue);
  });
});
