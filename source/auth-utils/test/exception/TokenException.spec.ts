// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, jest } from '@jest/globals';
import { TokenException } from '../../lib/exception/TokenException';

describe('TokenException test suite', () => {
  it('returns same token', () => {
    const errorMessage = 'test error';
    const tokenException = new TokenException(errorMessage);

    expect(tokenException.message).toEqual(errorMessage);
  });
});
