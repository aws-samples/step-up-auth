// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { v4 as uuidV4 } from 'uuid';
import { StepUpStateEnum } from './types';

/**
 * Model class that represents the `setting` table.
 */
class Setting {
  id: string;
  stepUpState?: StepUpStateEnum;
  createTimestamp?: string;
  lastUpdateTimestamp?: string;

  /**
   * C-TOR
   */
  constructor(id?: string, stepUpState?: StepUpStateEnum) {
    this.id = id || uuidV4();
    this.stepUpState = stepUpState || StepUpStateEnum.STEP_UP_NOT_REQUIRED;
    this.createTimestamp = "";
    this.lastUpdateTimestamp = "";
  }
}

export { Setting };
