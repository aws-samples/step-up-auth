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
import { Session, DEFAULT_SESSION_LIFETIME_SECONDS } from './model/Session';
import { StepUpStatusEnum } from './model/types';
import { CreateException } from './exception/CreateException';
import { RecordNotFoundException } from './exception/RecordNotFoundException';
import { ReadException } from './exception/ReadException';
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
   * Create session in DynamoDB table.  The row must have a session id and a ttl that is in the future
   * and at most 15 minutes away (the ceiling of both SESSION_TABLE_ITEM_TTL and STEP_UP_CHALLENGE_TTL),
   * so no caller can write a long-lived step-up session.
   * @param {Session} session Session object
   * @returns {string} session id
   * @throws {CreateException} If the session id or ttl is invalid, or the DynamoDB operation fails
   */
   public async createSession(session: Session): Promise<string> {
    const nowInSeconds = Math.floor(Date.now() / 1000);
    if (!session || !session.sessionId) {
      const errorMessage = 'refusing to write a session without a session id';
      log.error(errorMessage);
      throw new CreateException(errorMessage);
    }
    // 1 second allowance: callers round the current time, this check floors it
    if (!Number.isFinite(session.ttl) || session.ttl <= nowInSeconds ||
        session.ttl > nowInSeconds + DEFAULT_SESSION_LIFETIME_SECONDS + 1) {
      const errorMessage = `refusing to write session ${session.sessionId} with ttl ${session.ttl}: ` +
        `it must be in the future and at most ${DEFAULT_SESSION_LIFETIME_SECONDS} seconds away`;
      log.error(errorMessage);
      throw new CreateException(errorMessage);
    }

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
   * @param {number} tokenExp optional `exp` claim (epoch seconds) of the access token.  When set, ttl never exceeds it
   * @returns {string} session id
   * @throws {CreateException} If DynamoDB operation fails, throw 'Error'
   */
   public async createSessionWithParams(sessionId?: string, userId?: string, clientId?: string, token?: string, referrerUrl?: string, stepUpStatus?: StepUpStatusEnum, tokenExp?: number): Promise<string> {
    // get current timestamp
    const now = new Date();
    // create new rule (or record in db) based on incoming parameters
    const session: Session = new Session(sessionId, userId, clientId, token, referrerUrl, stepUpStatus);
    // set timestamps
    session.createTimestamp = now.toISOString();
    session.lastUpdateTimestamp = now.toISOString();
    // update TTL (capped at token expiry)
    session.ttl = this.computeTtl(Math.round(now.getTime() / 1000), tokenExp);

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
   * Create a one-time step-up challenge row with an EXPLICIT, absolute ttl (epoch seconds).
   *
   * Unlike {@link createSessionWithParams}, the absolute ttl is derived here from the SAME clock read
   * that sets the stored creation timestamp, and is deliberately NOT run through {@link computeTtl}.
   * Taking the lifetime (not a pre-computed absolute ttl) means the written row always satisfies
   * `ttl === floor(Date.parse(createTimestamp) / 1000) + lifetimeSeconds`: a caller computing the
   * absolute ttl from its own earlier clock read could disagree with this row's creation time across a
   * second rollover, whereas a single read here cannot.  So the challenge lifetime is governed solely
   * by the caller's `STEP_UP_CHALLENGE_TTL` and can never be silently shortened by
   * `SESSION_TABLE_ITEM_TTL`, even if that variable is ever set on the initiate Lambda.  A challenge
   * carries no access token, so there is no token `exp` to cap against; its only control is this ttl.
   * @param {string} sessionId session id (e.g. `challenge#<challengeId>`)
   * @param {string} userId user id (Cognito `sub`) the challenge is minted for
   * @param {StepUpStatusEnum} stepUpStatus step-up status to store on the row
   * @param {number} lifetimeSeconds challenge lifetime in seconds (`STEP_UP_CHALLENGE_TTL`); the
   *   absolute ttl is derived from the same creation timestamp stored on the row
   * @returns {string} session id
   * @throws {CreateException} If DynamoDB operation fails, throw 'Error'
   */
  public async createChallengeSession(sessionId: string, userId: string, stepUpStatus: StepUpStatusEnum, lifetimeSeconds: number): Promise<string> {
    // one clock read drives both the stored creation timestamp and the absolute ttl
    const now = new Date();
    // create the challenge record
    const session: Session = new Session(sessionId, userId, undefined, undefined, '', stepUpStatus);
    // set timestamps
    session.createTimestamp = now.toISOString();
    session.lastUpdateTimestamp = now.toISOString();
    // derive the absolute ttl from the same `now` as createTimestamp, so the row always satisfies
    // ttl === floor(Date.parse(createTimestamp) / 1000) + lifetimeSeconds.  intentionally bypasses
    // computeTtl() so SESSION_TABLE_ITEM_TTL can never shorten a challenge below STEP_UP_CHALLENGE_TTL
    session.ttl = Math.floor(now.getTime() / 1000) + lifetimeSeconds;

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
   * @throws {RecordNotFoundException} If there is no session for given session id
   * @throws {ReadException} If DynamoDB operation fails
   */
  public async getSession(sessionId: string): Promise<Session> {
    // construct parameters for the GetItemCommand
    const input: GetItemCommandInput = {
    TableName: this.tableName,
      Key: {
        sessionId: { S: sessionId }
      }
    };

    let output: GetItemCommandOutput;
    try {
      output = await this.client.send(new GetItemCommand(input));
    }
    catch ( err: any ) {
      const errorMessage = `error while retrieving record with sessionId: ${sessionId} - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      throw new ReadException(errorMessage);
    }

    if (output && output.Item) {
      const session: Session = unmarshall(output.Item) as Session;
      return session;
    }

    // Item was undefined
    const errorMessage = `unable to locate record with sessionId: ${sessionId}`;
    log.error(errorMessage);
    throw new RecordNotFoundException(errorMessage);
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
   * Atomically consume (delete) a session in a single conditional `DeleteItem`, succeeding only if the
   * row still exists.  This makes a one-time challenge genuinely one-time: when two requests race to
   * consume the same challenge, DynamoDB serialises the writes to that item, so exactly one
   * `DeleteItem` finds the row present and succeeds while the other's `attribute_exists` condition
   * fails and is rejected here.  Only the winning caller may then record a completed step-up session,
   * so a single challenge can never yield two elevations.  Unlike {@link deleteSession}, it performs no
   * prior read, which would reintroduce a check-then-act race between the read and the delete.
   * @param {string} sessionId session id
   * @returns {string} the consumed session id (returned only to the single winning caller)
   * @throws {RecordNotFoundException} if the row no longer exists (already consumed, or expired)
   */
  public async consumeSession(sessionId: string): Promise<string> {
    const input: DeleteItemCommandInput = {
      TableName: this.tableName,
      Key: {
        sessionId: { S: sessionId }
      },
      // delete only while the row is still present; a concurrent consumer that already deleted it
      // makes this condition fail, so exactly one caller wins the race
      ConditionExpression: 'attribute_exists(sessionId)'
    };
    try {
      const output: DeleteItemCommandOutput = await this.client.send(new DeleteItemCommand(input));
      log.debug(`successfully consumed session.  ${output.$metadata.httpStatusCode}`);
      return sessionId;
    } catch ( err: any ) {
      const errorMessage = `unable to consume session with sessionId: ${sessionId} - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      throw new RecordNotFoundException(errorMessage);
    }
  }


  /**
   * Update session in DynamoDB table
   * @param {Session} session Session object
   * @param {string} lastUpdateTimestamp last update timestamp
   * @param {number} tokenExp optional `exp` claim (epoch seconds) of the access token.  When set, ttl never exceeds it
   * @returns {string} session id
   * @throws {UpdateException} If operation fails, throw 'Error'
   */
  public async updateSession(session: Session, lastUpdateTimestamp?: string, tokenExp?: number): Promise<string> {
    // get current timestamp
    const now = new Date();

    // copy into new object. this ensures we don't inadvertently change the object passed in as parameter
    // typescript function parameters are pass by reference.
    let record = new Session();
    record = Object.assign(record, session);

    // update timestamp
    if (lastUpdateTimestamp !== undefined) {
      record.lastUpdateTimestamp = lastUpdateTimestamp;
      // update ttl based on lastUpdateTimestamp (capped at token expiry)
      const lastUpdateDate = new Date(lastUpdateTimestamp);
      record.ttl = this.computeTtl(Math.round(lastUpdateDate.getTime() / 1000), tokenExp);
    } else {
      record.lastUpdateTimestamp = now.toISOString();
      // update ttl based on current timestamp (capped at token expiry)
      record.ttl = this.computeTtl(Math.round(now.getTime() / 1000), tokenExp);
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
   * @param {number} tokenExp optional `exp` claim (epoch seconds) of the access token.  When set, ttl never exceeds it
   * @returns {string} session id
   * @throws {RecordNotFoundException} If there is no session for given session id
   * @throws {ReadException} If the session cannot be read
   * @throws {UpdateException} If update operation fails
   */
  public async updateStepUpStatus(sessionId: string, stepUpStatus: StepUpStatusEnum, tokenExp?: number): Promise<string> {
    // retrieve session object
    const session: Session = await this.getSession(sessionId);

    // update attributes
    session.stepUpStatus = stepUpStatus;

    return this.updateSession(session, undefined, tokenExp);
  }

  /**
   * Mark stepUpStatus in DynamoDB session table to STEP_UP_COMPLETED
   * @param {string} sessionId session id
   * @param {number} tokenExp optional `exp` claim (epoch seconds) of the access token.  When set, ttl never exceeds it
   * @return {string} session id
   * @throws {RecordNotFoundException} If session is missing, throw 'Error'
   * @throws {UpdateException} If update operation fails, throw 'Error'
   */
  public async completeStepUpRequest(sessionId: string, tokenExp?: number): Promise<string> {
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
      updatedSessionId = await this.updateSession(session, undefined, tokenExp);
    } catch( exp ) {
      const errorMessage: string = `unable to update record in request table for sessionId: ${sessionId}`;
      throw new UpdateException(errorMessage);
    }

    return updatedSessionId;
  }

  /**
   * Compute the session ttl: base + SESSION_TABLE_ITEM_TTL, capped at the token expiry
   * so that a session never outlives the access token it was created for
   * @param {number} baseEpochSeconds base timestamp in epoch seconds
   * @param {number} tokenExp optional `exp` claim (epoch seconds) of the access token
   * @returns {number} ttl in epoch seconds
   */
  private computeTtl(baseEpochSeconds: number, tokenExp?: number): number {
    const ttl = baseEpochSeconds + this.sessionTableItemTTLInSeconds;
    if (tokenExp !== undefined && tokenExp > 0) {
      return Math.min(ttl, tokenExp);
    }
    return ttl;
  }

}

export { SessionClient };
