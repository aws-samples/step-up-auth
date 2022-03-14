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
import { Session } from './model/Session';
import { StepUpStatusEnum } from './model/types';
import { CreateException } from './exception/CreateException';
import { RecordNotFoundException } from './exception/RecordNotFoundException';
import { UpdateException } from './exception/UpdateException';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

/**
 * Class contains common operations for interacting with `session` table
 * @extends Client
 */
class SessionClient extends Client {
  private tableName: string =
    this.environmentPrefix ? `step-up-auth-session-${this.environmentPrefix}` : 'step-up-auth-session';

  /**
   * C-TOR
   */
   constructor() {
    super();
  }

  /**
   * Create session in DynamoDB table
   * @param {Session} session Session object
   * @returns {string} session id
   * @throws {CreateException} If DynamoDB operation fails, throw 'Error'
   */
   public async createSession(session: Session): Promise<string> {

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
      Item: marshall(session, marshallOptions)
    };

    // create the record
    try {
      const output: PutItemCommandOutput = await this.client.send(new PutItemCommand(input));
      log.debug('put operation successful', JSON.stringify(output));
      return session.sessionId!;
    }
    catch ( err: any ) {
      const errorMessage = `error occurred during put item operation - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      throw new CreateException(errorMessage);
    }
  }

  /**
   * Create session in DynamoDB table
   * @param {string} sessionId session id
   * @param {string} userId user id
   * @param {string} clientId client id
   * @param {string} token authorization token value
   * @param {string} referrerUrl api path for which we are initiating the step up auth session
   * @param {StepUpStatusEnum} stepUpStatus enum indicating whether session requires elevated credentials
   * @returns {string} session id
   * @throws {CreateException} If DynamoDB operation fails, throw 'Error'
   */
   public async createSessionWithParams(sessionId?: string, userId?: string, clientId?: string, token?: string, referrerUrl?: string, stepUpStatus?: StepUpStatusEnum): Promise<string> {
    // get current timestamp
    const now = new Date();
    // create new rule (or record in db) based on incoming parameters
    const session: Session = new Session(sessionId, userId, clientId, token, referrerUrl, stepUpStatus);
    // set timestamps
    session.createTimestamp = now.toISOString();
    session.lastUpdateTimestamp = now.toISOString();
    // update TTL
    session.ttl = Math.round(now.getTime() / 1000) + this.sessionTableItemTTLInSeconds;

    // create the record
    try {
      const id = await this.createSession(session);
      return id;
    }
    catch ( err: any ) {
      const errorMessage = `error occurred during put item operation - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      throw new CreateException(errorMessage);
    }
  }

  /**
   * Retrieve item from session table for given session id
   * @param {string} sessionId session id
   * @return {Session} Session object
   * @throws {RecordNotFoundException} If operation fails, throw 'Error'
   */
  public async getSession(sessionId: string): Promise<Session> {
    // construct parameters for the GetItemCommand
    const input: GetItemCommandInput = {
    TableName: this.tableName,
      Key: {
        sessionId: { S: sessionId }
      }
    };

    try {
      const output: GetItemCommandOutput = await this.client.send(new GetItemCommand(input));
      if (output && output.Item) {
        const session: Session = unmarshall(output.Item) as Session;
        return session;
      }

      // Item was undefined
      const errorMessage = `unable to locate record with sessionId: ${sessionId}`;
      log.error(errorMessage);
      throw new RecordNotFoundException(errorMessage);
    }
    catch ( err: any ) {
      const errorMessage = `error while retrieving record with sessionId: ${sessionId} - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      throw new RecordNotFoundException(errorMessage);
    }
  }

  /**
   * Delete Session given an id (hash key)
   * @param {string} sessionId session id
   * @return {string} id of session object that was deleted
   * @throws {RecordNotFoundException} If operation fails, throw 'Error'
   */
  public async deleteSession(sessionId: string): Promise<string> {
    try {
      // retrieve session object
      const session: Session = await this.getSession(sessionId);

      // construct parameters for the DeleteItemCommand
      const input: DeleteItemCommandInput = {
        TableName: this.tableName,
        Key: {
          sessionId: { S: session.sessionId! }
        }
      };
      const output: DeleteItemCommandOutput = await this.client.send(new DeleteItemCommand(input));
      log.debug(`successfully deleted record.  ${output.$metadata.httpStatusCode}`);
      return session.sessionId!;
    } catch ( err: any ) {
      // const error = err as Error;
      let errorMessage = `error while deleting record with sessionId: ${sessionId} - ${err.name}: ${err.message}`;
      if (err && err.code === 'ResourceNotFoundException') {
        errorMessage = `error while deleting record with sessionId: ${sessionId}.  table not found`;
      } else if (err && err.code === 'ResourceInUseException') {
        errorMessage = `error while deleting record with sessionId: ${sessionId}.  table in use`;
      }
      log.error(errorMessage);
      throw new RecordNotFoundException(errorMessage);
    }
  }


  /**
   * Update session in DynamoDB table
   * @param {Session} session Session object
   * @param {string} lastUpdateTimestamp last update timestamp
   * @returns {string} session id
   * @throws {UpdateException} If operation fails, throw 'Error'
   */
  public async updateSession(session: Session, lastUpdateTimestamp?: string): Promise<string> {
    // get current timestamp
    const now = new Date();

    // copy into new object. this ensures we don't inadvertently change the object passed in as parameter
    // typescript function parameters are pass by reference.
    let record = new Session();
    record = Object.assign(record, session);

    // update timestamp
    if (lastUpdateTimestamp !== undefined) {
      record.lastUpdateTimestamp = lastUpdateTimestamp;
      // update ttl based on lastUpdateTimestamp
      const lastUpdateDate = new Date(lastUpdateTimestamp);
      record.ttl = Math.round(lastUpdateDate.getTime() / 1000) + this.sessionTableItemTTLInSeconds;
    } else {
      record.lastUpdateTimestamp = now.toISOString();
      // update ttl based on current timestamp
      record.ttl = Math.round(now.getTime() / 1000) + this.sessionTableItemTTLInSeconds;
    }

    // update the record
    try {
      // construct parameters for the PutItemCommand
      const input: UpdateItemCommandInput = {
        TableName: this.tableName,
        Key: {
          // primary key
          sessionId: { S: record.sessionId! }
          // sort key (ifn needed)
        },
        // expressions for the new or updated attributes
        UpdateExpression: 'set userId = :u, clientId = :c, #token = :t, referrerUrl = :r, stepUpStatus = :s, lastUpdateTimestamp = :l, #ttl = :ttl',
        ExpressionAttributeNames: {
          '#token': 'token', // token is a reserved word in DynamoDB
          '#ttl': 'ttl' // ttl is a reserved word in DynamoDB
        },
        ExpressionAttributeValues: {
          ':u': <AttributeValue> { 'S': record.userId},
          ':c': <AttributeValue> { 'S': record.clientId},
          ':t': <AttributeValue> { 'S': record.token},
          ':r': <AttributeValue> { 'S': record.referrerUrl},
          ':s': <AttributeValue> { 'S': record.stepUpStatus},
          ':l': <AttributeValue> { 'S': record.lastUpdateTimestamp},
          ':ttl': <AttributeValue> { 'N': record.ttl.toString()}
        }
      };

      const output: UpdateItemCommandOutput = await this.client.send(new UpdateItemCommand(input));
      log.debug('update operation successful', JSON.stringify(output));
      return record.sessionId!;
    }
    catch ( err: any ) {
      const errorMessage = `error occurred during update item operation - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      throw new UpdateException(errorMessage);
    }
  }

  /**
   * Update session `stepUpStatus` flag
   * @param {string} sessionId session id
   * @param {StepUpStatusEnum} stepUpStatus enum indicating step up auth status
   * @returns {string} session id
   * @throws {RecordNotFoundException} If operation fails, throw 'Error'
   */
  public async updateStepUpStatus(sessionId: string, stepUpStatus: StepUpStatusEnum): Promise<string> {
    // retrieve session object
    const session: Session = await this.getSession(sessionId);

    // update attributes
    session.stepUpStatus = stepUpStatus;

    return this.updateSession(session);
  }

  /**
   * Mark stepUpStatus in DynamoDB session table to STEP_UP_COMPLETED
   * @param {string} sessionId session id
   * @return {string} session id
   * @throws {RecordNotFoundException} If session is missing, throw 'Error'
   * @throws {UpdateException} If update operation fails, throw 'Error'
   */
  public async completeStepUpRequest(sessionId: string): Promise<string> {
    // retrieve the request from DynamoDB
    let session: Session = <Session>{};
    try {
      session = await this.getSession(sessionId);
    } catch( exp ) {
      const errorMessage: string = `unable to locate record in session table for sessionId: ${sessionId}`;
      throw new RecordNotFoundException(errorMessage);
    }

    // update stepUpStatus attribute
    session.stepUpStatus = StepUpStatusEnum.STEP_UP_COMPLETED;

    // update record in DynamoDB
    let updatedSessionId: string = '';
    try {
      updatedSessionId = await this.updateSession(session);
    } catch( exp ) {
      const errorMessage: string = `unable to update record in request table for sessionId: ${sessionId}`;
      throw new UpdateException(errorMessage);
    }

    return updatedSessionId;
  }

}

export { SessionClient };
