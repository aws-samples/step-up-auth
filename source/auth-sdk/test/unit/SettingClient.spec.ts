// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import {
  SettingClient,
  StepUpStateEnum,
  ReadException,
  RecordNotFoundException } from '../../index';

describe('SettingClient fail-closed setting lookup', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SendMock = jest.Mock<(...args: any[]) => any>;
  let sendMock: SendMock;

  const settingItem = (stepUpState: string) => ({
    Item: { id: { S: '/transfer' }, stepUpState: { S: stepUpState } }
  });

  beforeEach(() => {
    sendMock = jest.spyOn(DynamoDBClient.prototype, 'send') as unknown as SendMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns STEP_UP_NOT_REQUIRED when there is no setting row', async () => {
    sendMock.mockResolvedValue({});
    await expect(new SettingClient().getStepUpStatus('/transfer')).resolves.toBe(StepUpStateEnum.STEP_UP_NOT_REQUIRED);
    expect(sendMock.mock.calls[0][0]).toBeInstanceOf(GetItemCommand);
  });

  it('returns STEP_UP_DENY when the setting cannot be read', async () => {
    sendMock.mockRejectedValue(Object.assign(new Error('not authorized to perform dynamodb:GetItem'), { name: 'AccessDeniedException' }));
    await expect(new SettingClient().getStepUpStatus('/transfer')).resolves.toBe(StepUpStateEnum.STEP_UP_DENY);
  });

  it('returns STEP_UP_REQUIRED for a STEP_UP_REQUIRED row', async () => {
    sendMock.mockResolvedValue(settingItem('STEP_UP_REQUIRED'));
    await expect(new SettingClient().getStepUpStatus('/transfer')).resolves.toBe(StepUpStateEnum.STEP_UP_REQUIRED);
  });

  it('returns STEP_UP_NOT_REQUIRED for a STEP_UP_NOT_REQUIRED row', async () => {
    sendMock.mockResolvedValue(settingItem('STEP_UP_NOT_REQUIRED'));
    await expect(new SettingClient().getStepUpStatus('/transfer')).resolves.toBe(StepUpStateEnum.STEP_UP_NOT_REQUIRED);
  });

  it('returns STEP_UP_DENY for a STEP_UP_DENY row', async () => {
    sendMock.mockResolvedValue(settingItem('STEP_UP_DENY'));
    await expect(new SettingClient().getStepUpStatus('/transfer')).resolves.toBe(StepUpStateEnum.STEP_UP_DENY);
  });

  it('returns STEP_UP_DENY for an unknown value', async () => {
    sendMock.mockResolvedValue(settingItem('BOGUS'));
    await expect(new SettingClient().getStepUpStatus('/transfer')).resolves.toBe(StepUpStateEnum.STEP_UP_DENY);
  });

  it('getSetting() throws ReadException on a DynamoDB error and RecordNotFoundException for a missing row', async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' }));
    await expect(new SettingClient().getSetting('/transfer')).rejects.toBeInstanceOf(ReadException);

    sendMock.mockResolvedValueOnce({});
    await expect(new SettingClient().getSetting('/transfer')).rejects.toBeInstanceOf(RecordNotFoundException);
  });
});
