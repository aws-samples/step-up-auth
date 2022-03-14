// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from '@jest/globals';
import { SettingClient } from '../../../index';
import { Setting } from '../../../index';
import { StepUpStateEnum } from '../../../index';

describe('SettingClient test suite', () => {

  it('creates and delete a record', async () => {

    // test setup
    const setting = new Setting('api', StepUpStateEnum.STEP_UP_REQUIRED);
    // get current timestamp
    const now = new Date();
    // set timestamps
    setting.createTimestamp = now.toISOString();
    setting.lastUpdateTimestamp = now.toISOString();

    // instantiate client
    const client = new SettingClient();

    // create a record
    const id = await client.createSetting(setting);

    // fetch the same record
    const retrievedSetting = await client.getSetting(id);

    // assert
    expect(id).toEqual(setting.id);
    expect(retrievedSetting).toEqual(setting);

    // update the same record
    const updatedId = await client.updateStepUpStatus(retrievedSetting, StepUpStateEnum.STEP_UP_NOT_REQUIRED);
    const retrieveSettingAfterUpdate = await client.getSetting(updatedId);

    // assert
    expect(retrieveSettingAfterUpdate.stepUpState).toEqual(StepUpStateEnum.STEP_UP_NOT_REQUIRED);
    expect(retrieveSettingAfterUpdate.lastUpdateTimestamp).not.toEqual(retrievedSetting.lastUpdateTimestamp);

    // delete the same record
    const deletedId = await client.deleteSetting(id);

    // assert
    expect(deletedId).toEqual(setting.id);
  });

});
