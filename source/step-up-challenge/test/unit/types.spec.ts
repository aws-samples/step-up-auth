// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from '@jest/globals';
import { ChallengeTypesEnum } from '../../src/types';

describe('Challenge Type Enum test suite', () => {
  it('Challenge Type expected value', async () => {
    // value to test
    const smsChallengeName = 'SMS_STEP_UP';
    const softwareTokenChallengeName = 'SOFTWARE_TOKEN_STEP_UP';
    expect(ChallengeTypesEnum.SMS_STEP_UP).toEqual(smsChallengeName);
    expect(ChallengeTypesEnum.SOFTWARE_TOKEN_STEP_UP).toEqual(softwareTokenChallengeName);
  });
});
