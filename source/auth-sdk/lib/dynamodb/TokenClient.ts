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
import { Token } from './model/Token';
import { CreateException } from './exception/CreateException';
import { RecordNotFoundException } from './exception/RecordNotFoundException';
import { UpdateException } from './exception/UpdateException';
import { TokenStatusEnum, TokenChannelTypeEnum } from './model/types';

import {
  SNSClient,
  PublishCommand,
  PublishCommandInput,
  PublishCommandOutput } from '@aws-sdk/client-sns';
import {
  SESClient,
  SendEmailCommand,
  SendEmailCommandInput,
  SendEmailCommandOutput } from '@aws-sdk/client-ses';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

/**
 * Class contains common operations for interacting with `token` table and SNS/SES services
 * @extends Client
 */
class TokenClient extends Client {
  private tableName: string =
    this.environmentPrefix ? `step-up-auth-token-${this.environmentPrefix}` : 'step-up-auth-token';
  private sesClient: SESClient;
  private snsClient: SNSClient;

  /**
   * C-TOR
   */
  constructor() {
    super();

    this.sesClient = new SESClient({region: this.awsRegion});
    this.snsClient = new SNSClient({region: this.awsRegion});
  }

  /**
   * Create token in DynamoDB table
   * @param {Token} token Token object
   * @returns {string} request id
   * @throws {CreateException} If DynamoDB operation fails, throw 'Error'
   */
  public async createToken(token: Token): Promise<string> {

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
      Item: marshall(token, marshallOptions)
    };

    // create the record
    try {
      const output: PutItemCommandOutput = await this.client.send(new PutItemCommand(input));
      log.debug('put operation successful', JSON.stringify(output));
      return token.id!;
    }
    catch ( err ) {
      const errorMessage = `error occurred during put item operation - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      throw new CreateException(errorMessage);
    }
  }

  /**
   * Create Token in DynamoDB table
   * @param {string} id token id.  this could be set to same value as sessionId in session table
   * @returns {string} temporary token
   * @throws {CreateException} If DynamoDB operation fails, throw 'Error'
   */
  public async createTokenWithParams(id: string): Promise<string> {
    // get current timestamp
    const now = new Date();
    // create new token (or record in db) based on incoming parameters
    const token: Token = new Token(id);
    // set timestamps
    token.createTimestamp = now.toISOString();
    token.lastUpdateTimestamp = now.toISOString();
    // update TTL
    token.ttl = Math.round(now.getTime() / 1000) + this.tokenTableItemTTLInSeconds;

    // create the record
    try {
      const id = await this.createToken(token);
      return id;
    }
    catch ( err ) {
      const errorMessage = `error occurred during put item operation - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      throw new CreateException(errorMessage);
    }
  }

  /**
   * Retrieve item from token table for given id
   * @param {string} id token id
   * @return {Token} Token object
   * @throws {RecordNotFoundException} If operation fails, throw 'Error'
   */
  public async getToken(id: string): Promise<Token> {
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
        const token: Token = unmarshall(output.Item) as Token;
        return token;
      }

      // Item was undefined
      const errorMessage = `unable to locate record with id: ${id}`;
      log.error(errorMessage);
      throw new RecordNotFoundException(errorMessage);
    }
    catch ( err ) {
      const errorMessage = `error while retrieving record with id: ${id} - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      throw new RecordNotFoundException(errorMessage);
    }
  }

  /**
   * Delete Token given an id (hash key)
   * @param {string} requestId request id
   * @return {string} requestId that the token was deleted
   * @throws {RecordNotFoundException} If operation fails, throw 'Error'
   */
  public async deleteToken(id: string): Promise<string> {
    try {
      // retrieve token object
      const token: Token = await this.getToken(id);

      // construct parameters for the DeleteItemCommand
      const input: DeleteItemCommandInput = {
        TableName: this.tableName,
        Key: {
          id: { S: token.id! }
        }
      };
      const output: DeleteItemCommandOutput = await this.client.send(new DeleteItemCommand(input));
      log.debug(`successfully deleted record.  ${output.$metadata.httpStatusCode}`);
      return token.id!;
    } catch ( err ) {
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
   * Update Token in DynamoDB table
   * @param {Token} token Token object
   * @param {string} lastUpdateTimestamp last update timestamp
   * @returns {string} token id
   * @throws {UpdateException} If operation fails, throw 'Error'
   */
  public async updateToken(token: Token, lastUpdateTimestamp?: string): Promise<string> {
    // get current timestamp
    const now = new Date();

    // copy token into Token object preserving all fields
    let record = new Token(token.id!);
    record = Object.assign(record, token);

    // update timestamp
    if (lastUpdateTimestamp !== undefined) {
      record.lastUpdateTimestamp = lastUpdateTimestamp;
      // update ttl based on lastUpdateTimestamp
      const lastUpdateDate = new Date(lastUpdateTimestamp);
      record.ttl = Math.round(lastUpdateDate.getTime() / 1000) + this.tokenTableItemTTLInSeconds;
    } else {
      record.lastUpdateTimestamp = now.toISOString();
      // update ttl based on current timestamp
      record.ttl = Math.round(now.getTime() / 1000) + this.tokenTableItemTTLInSeconds;
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
        UpdateExpression: 'set temporaryToken = :t, #status = :s, channel = :c, lastUpdateTimestamp = :l, #ttl = :ttl',
        ExpressionAttributeNames: {
          "#status": 'status',
          '#ttl': 'ttl'
        },
        ExpressionAttributeValues: {
          ':t': <AttributeValue> { 'S': record.temporaryToken},
          ':s': record.status ? <AttributeValue> { 'S': record.status} : <AttributeValue> { 'NULL': true },
          ':c': record.channel ? <AttributeValue> { 'S': record.channel} : <AttributeValue> { 'NULL': true },
          ':l': <AttributeValue> { 'S': record.lastUpdateTimestamp},
          ':ttl': <AttributeValue> { 'N': record.ttl.toString()}
        }
      };

      const output: UpdateItemCommandOutput = await this.client.send(new UpdateItemCommand(input));
      log.debug('update operation successful', JSON.stringify(output));
      return record.id!;
    }
    catch ( err ) {
      const errorMessage = `error occurred during update item operation - ${err.name}: ${err.message}`;
      log.error(errorMessage);
      throw new UpdateException(errorMessage);
    }
  }

  /**
   * Update token `status` flag
   * @param {string} id token id
   * @param {TokenStatusEnum} tokenStatus enum indicating token status
   * @returns {string} setting id
   */
   public async updateStatus(id: string, tokenStatus: TokenStatusEnum): Promise<string> {
    // retrieve token object
    const token: Token = await this.getToken(id);

    // update attributes
    token.status = tokenStatus;

    return this.updateToken(token);
  }

  /**
   * Update token `channel` flag
   * @param {string} id token id
   * @param {TokenChannelTypeEnum} channel enum indicating channel type
   * @returns {string} setting id
   */
   public async updateChannelType(id: string, channelType: TokenChannelTypeEnum): Promise<string> {
    // retrieve token object
    const token: Token = await this.getToken(id);

    // update attributes
    token.channel = channelType;

    return this.updateToken(token);
  }

  /**
   * Send temporary token to a verified email address
   * ref: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-ses/classes/sendemailcommand.html
   * ref: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-ses/
   * @param {string} temporaryToken temporary token
   * @param {string} email send temporary token to given email
   */
  public async sendTemporaryTokenInEmail(temporaryToken: string, toEmail: string, fromEmail: string): Promise<string> {
    let result: SendEmailCommandOutput = <SendEmailCommandOutput>{};
    try {
      // create sendEmail params
      const params: SendEmailCommandInput = {
        Destination: {
          ToAddresses: [ toEmail ]
        },
        Message: {
          Body: {
            // Html: {
            //  Charset: "UTF-8",
            //  Data: "HTML_FORMAT_BODY"
            // },
            Text: {
              Charset: "UTF-8",
              Data: `your temporary token is ${temporaryToken}`
            }
          },
          Subject: {
            Charset: 'UTF-8',
            Data: 'Temporary Token'
          }
        },
        Source: fromEmail
      };
      // send email
      result = await this.sesClient.send(new SendEmailCommand(params));
    } catch( exp ) {
      result.MessageId = 'ERROR';
    }

    return result.MessageId!;
  }

  /**
   * Send temporary token to an auto-opt-in phone number
   * Note that phone number doesn't need to be verified before sending SMS
   * ref: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-sns/
   * @param {string} temporaryToken temporary token
   * @param {string} phoneNumber send temporary token to given phone number via SMS
   */
  public async sendTemporaryTokenInSms(temporaryToken: string, phoneNumber: string): Promise<string> {
    let result: PublishCommandOutput = <PublishCommandOutput>{};
    try {
      // Create publish parameters
      const params: PublishCommandInput = {
        Message: `your temporary token is ${temporaryToken}`,
        PhoneNumber: phoneNumber,
      };
      // send sms
      result = await this.snsClient.send(new PublishCommand(params));
    } catch ( exp ) {
      result.MessageId = 'ERROR';
    }
    return result.MessageId!;
  }
}

export { TokenClient };
