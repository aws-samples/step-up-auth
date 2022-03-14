// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from '@jest/globals';
import { TokenClient } from '../../../index';
import { Token } from '../../../index';
import { TokenStatusEnum, TokenChannelTypeEnum } from '../../../index';

describe('TokenClient test suite', () => {

  it('creates and delete a record', async () => {

    // test setup
    const token = new Token();

    // get current timestamp
    const now = new Date();
    // set timestamps
    token.createTimestamp = now.toISOString();
    token.lastUpdateTimestamp = now.toISOString();

    // instantiate client
    const client = new TokenClient();

    // create a record
    const id = await client.createToken(token);

    // fetch the same record
    const retrievedToken = await client.getToken(id);

    // assert
    expect(id).toEqual(retrievedToken.id);

    // update the same record
    let updatedId = await client.updateStatus(retrievedToken.id!, TokenStatusEnum.SENT);
    updatedId = await client.updateChannelType(retrievedToken.id!, TokenChannelTypeEnum.EMAIL);
    const retrieveTokenAfterUpdate = await client.getToken(updatedId);

    // assert
    expect(retrieveTokenAfterUpdate.status).toEqual(TokenStatusEnum.SENT);
    expect(retrieveTokenAfterUpdate.channel).toEqual(TokenChannelTypeEnum.EMAIL);
    expect(retrieveTokenAfterUpdate.lastUpdateTimestamp).not.toEqual(retrievedToken.lastUpdateTimestamp);

    // delete the same record
    const deletedId = await client.deleteToken(id!);

    // assert
    expect(deletedId).toEqual(retrievedToken.id!);
  });

  it('creates and delete a record with custom id', async () => {
    // test setup
    const id = '1234567890';
    const token = new Token(id);

    // get current timestamp
    const now = new Date();
    // set timestamps
    token.createTimestamp = now.toISOString();
    token.lastUpdateTimestamp = now.toISOString();

    // instantiate client
    const client = new TokenClient();

    // create a record
    const createdId = await client.createToken(token);

    // fetch the same record
    const retrievedToken = await client.getToken(id);

    // assert
    expect(createdId).toEqual(retrievedToken.id);

    // delete the same record
    const deletedId = await client.deleteToken(createdId!);

    // assert
    expect(deletedId).toEqual(createdId!);
  });

   it('sends temporary token to a verified email address', async() => {
     // test setup
    const token = new Token();

    // get current timestamp
    const now = new Date();
    // set timestamps
    token.createTimestamp = now.toISOString();
    token.lastUpdateTimestamp = now.toISOString();

    // instantiate client
    const client = new TokenClient();

    // create a record
    const id = await client.createToken(token);

    // fetch the same record
    const retrievedToken = await client.getToken(id);

    // setup email info
    const toEmail = 'yourname@somedomain.com'; // email must be verified in SNS first
    const fromEmail = 'yourname@somedomain.com';

    // send temporary token
    const result = await client.sendTemporaryTokenInEmail(retrievedToken.temporaryToken!, toEmail, fromEmail);

    // assert
    expect(result).not.toEqual('ERROR');
  });

  it('sends temporary token to valid phone number', async() => {
    const token = new Token();

    // get current timestamp
    const now = new Date();
    // set timestamps
    token.createTimestamp = now.toISOString();
    token.lastUpdateTimestamp = now.toISOString();

    // instantiate client
    const client = new TokenClient();

    // create a record
    const id = await client.createToken(token);

    // fetch the same record
    const retrievedToken = await client.getToken(id);

    // setup sms info
    const phoneNumber = '+15555555555'; // replace with a valid NA #

    // send temporary token
    const result = await client.sendTemporaryTokenInSms(retrievedToken.temporaryToken!, phoneNumber);

    // assert
    expect(result).not.toEqual('ERROR');
  });

});
