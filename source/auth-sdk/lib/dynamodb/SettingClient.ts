// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  PutItemCommand,
  PutItemCommandInput,
  PutItemCommandOutput,
  GetItemCommand,
  GetItemCommandInput,
  GetItemCommandOutput,
  DeleteItemCommand,
  DeleteItemCommandInput,
  DeleteItemCommandOutput,
  UpdateItemCommand,
  UpdateItemCommandInput,
  UpdateItemCommandOutput,
  AttributeValue} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { Logger } from '@step-up-auth/auth-utils';
import { Client } from './Client';
import { Setting } from './model/Setting';
import { CreateException } from './exception/CreateException';
import { RecordNotFoundException } from './exception/RecordNotFoundException';
import { UpdateException } from './exception/UpdateException';
import { StepUpStateEnum } from './model/types';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

/**
 * Class contains common operations for interacting with `settings` table
 * @extends Client
 */
class SettingClient extends Client {
  private tableName: string =
    this.environmentPrefix ? `step-up-auth-setting-${this.environmentPrefix}` : 'step-up-auth-setting';

  /**
   * C-TOR
   */
  constructor() {
    super();
  }

  /**
   * Create setting in DynamoDB table
   * @param {Setting} setting Setting object
   * @returns {string} setting id
   * @throws {CreateException} If DynamoDB operation fails, throw 'Error'
   */
  public async createSetting(setting: Setting): Promise<string> {

    const marshallOptions = {
      // Whether to automatically convert empty strings, blobs, and sets to `null`.
      convertEmptyValues: false, // false, by default.
      // Whether to remove undefined values while marshalling.
      removeUndefinedValues: true, // false, by default.
      // Whether to convert typeof object to map attribute.
      convertClassInstanceToMap: true // false, by default.
    };

    // construct parameters for the PutItemCommand
    const input: PutItemCommandInput = {
      TableName: this.tableName,
      Item: marshall(setting, marshallOptions)
    };

    // create the record
    try {
      const output: PutItemCommandOutput = await this.client.send(new PutItemCommand(input));
      log.debug('put operation successful', JSON.stringify(output));
      return setting.id!;
    }
    catch ( err: any ) {
      const errorMessage = `error occurred during put item operation - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      throw new CreateException(errorMessage);
    }
  }

  /**
   * Create setting in DynamoDB table
   * @param {string} id setting id
   * @param {StepUpStateEnum} stepUpState enum indicating whether session requires elevated credentials
   * @returns {string} setting id
   * @throws {CreateException} If DynamoDB operation fails, throw 'Error'
   */
   public async createSettingWithParams(id: string, stepUpState: StepUpStateEnum): Promise<string> {
     // get current timestamp
    const now = new Date();
    // create new rule (or record in db) based on incoming parameters
    const setting: Setting = new Setting(id, stepUpState);
    // set timestamps
    setting.createTimestamp = now.toISOString();
    setting.lastUpdateTimestamp = now.toISOString();

    // create the record
    try {
      const id = await this.createSetting(setting);
      return id;
    }
    catch ( err: any ) {
      const errorMessage = `error occurred during put item operation - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      throw new CreateException(errorMessage);
    }
  }

  /**
   * Retrieve item from setting table for given id
   * @param {string} id setting id
   * @return {Setting} Setting object
   * @throws {RecordNotFoundException} If operation fails, throw 'Error'
   */
   public async getSetting(id: string): Promise<Setting> {
    // construct parameters for the GetItemCommand
    const input: GetItemCommandInput = {
      TableName: this.tableName,
      Key: {
        id: { S: id }
      }
    };

    try {
      const output: GetItemCommandOutput = await this.client.send(new GetItemCommand(input));
      if (output && output.Item) {
        const setting: Setting = unmarshall(output.Item) as Setting;
        return setting;
      }

      // Item was undefined
      const errorMessage = `unable to locate record with id: ${id}`;
      log.error(errorMessage);
      throw new RecordNotFoundException(errorMessage);
    }
    catch ( err: any ) {
      const errorMessage = `error while retrieving record with id: ${id} - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      throw new RecordNotFoundException(errorMessage);
    }
  }

  /**
   * Delete Setting given an id (hash key)
   * @param {string} id setting id
   * @return {string} id of setting object that was deleted
   * @throws {RecordNotFoundException} If operation fails, throw 'Error'
   */
   public async deleteSetting(id: string): Promise<string> {
    try {
      // retrieve setting object
      const setting: Setting = await this.getSetting(id);

      // construct parameters for the DeleteItemCommand
      const input: DeleteItemCommandInput = {
        TableName: this.tableName,
        Key: {
          id: { S: setting.id! }
        }
      };
      const output: DeleteItemCommandOutput = await this.client.send(new DeleteItemCommand(input));
      log.debug(`successfully deleted record.  ${output.$metadata.httpStatusCode}`);
      return setting.id!;
    } catch ( err: any ) {
      let errorMessage = `error while deleting record with id: ${id} - ${err.name}: ${err.message}`;
      if (err && err.code === 'ResourceNotFoundException') {
        errorMessage = `error while deleting record with id: ${id}.  table not found`;
      } else if (err && err.code === 'ResourceInUseException') {
        errorMessage = `error while deleting record with id: ${id}.  table in use`;
      }
      log.error(errorMessage);
      throw new RecordNotFoundException(errorMessage);
    }
  }

  /**
   * Update setting in DynamoDB table
   * @param {Setting} setting Setting object
   * @param {string} lastUpdateTimestamp last update timestamp
   * @returns {string} setting id
   * @throws {UpdateException} If operation fails, throw 'Error'
   */
  public async updateSetting(setting: Setting, lastUpdateTimestamp?: string): Promise<string> {
    // get current timestamp
    const now = new Date();

    // copy into new object. this ensures we don't inadvertently change the object passed in as parameter
    // typescript function parameters are pass by reference.
    let record = new Setting();
    record = Object.assign(record, setting);

    // update timestamp
    if (lastUpdateTimestamp !== undefined) {
      record.lastUpdateTimestamp = lastUpdateTimestamp;
    } else {
      record.lastUpdateTimestamp = now.toISOString();
    }

    // update the record
    try {
      // construct parameters for the PutItemCommand
      const input: UpdateItemCommandInput = {
        TableName: this.tableName,
        Key: {
          // primary key
          id: { S: record.id! }
          // sort key (ifn needed)
        },
        // expressions for the new or updated attributes
        UpdateExpression: 'set stepUpState = :s, lastUpdateTimestamp = :l',
        ExpressionAttributeValues: {
          ':s': <AttributeValue> { 'S': record.stepUpState},
          ':l': <AttributeValue> { 'S': record.lastUpdateTimestamp}
        }
      };

      const output: UpdateItemCommandOutput = await this.client.send(new UpdateItemCommand(input));
      log.debug('update operation successful', JSON.stringify(output));
      return record.id!;
    }
    catch ( err: any ) {
      const errorMessage = `error occurred during update item operation - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      throw new UpdateException(errorMessage);
    }
  }

  /**
   * Update setting `stepUpState` flag
   * @param {Setting} setting Setting object
   * @param {StepUpStateEnum} stepUpState enum indicating step up auth status
   * @returns {string} setting id
   */
   public async updateStepUpStatus(setting: Setting, stepUpState: StepUpStateEnum): Promise<string> {

    // update attributes
    setting.stepUpState = stepUpState;


    return this.updateSetting(setting);
  }

  /**
   * Convenience wrapper method around getSetting() that returns
   * stepUpState enum based on whether step-up authentication is
   * required for given api path
   * @param {string} api URI component or ARN of an API
   * @return {StepUpStateEnum} return enumeration indicating whether step-auth is required for given api
   */
   public async getStepUpStatus(api: string): Promise<StepUpStateEnum> {
    try {
      const setting: Setting = await this.getSetting(api);
      log.debug(`retrieved settings for api ${api} stepUpState ${setting.stepUpState}`);
      if (setting.stepUpState === StepUpStateEnum.STEP_UP_REQUIRED) {
        return StepUpStateEnum.STEP_UP_REQUIRED;
      }
      else if (setting.stepUpState === StepUpStateEnum.STEP_UP_DENY) {
        return StepUpStateEnum.STEP_UP_DENY;
      }
    } catch (err: any) {
      // if we did not find setting for api, getSetting() threw an error
      // we return STEP_UP_NOT_REQUIRED enum
      const errorMessage = `error occurred during getSetting operation - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      return StepUpStateEnum.STEP_UP_NOT_REQUIRED;
    }

    // in all other cases, return STEP_UP_NOT_REQUIRED enum
    return StepUpStateEnum.STEP_UP_NOT_REQUIRED;
  }

}

export { SettingClient };
