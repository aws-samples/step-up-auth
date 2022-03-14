// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from '@jest/globals';
import { SessionClient } from '../../../index';
import { Session } from '../../../index';
import { StepUpStatusEnum } from '../../../index';

describe('SessionClient test suite', () => {

  it('creates and delete a record', async () => {

    // test setup
    let sessionId;
    const userId = 'user-id';
    const clientId = 'client-id';
    const token = 'dummy token';
    const referrerUrl = 'http://api/path';
    const stepUpStatus = StepUpStatusEnum.STEP_UP_REQUIRED;
    const session = new Session(sessionId, userId, clientId, token, referrerUrl, stepUpStatus);
    // get current timestamp
    const now = new Date();
    // set timestamps
    session.createTimestamp = now.toISOString();
    session.lastUpdateTimestamp = now.toISOString();

    // instantiate client
    const client = new SessionClient();

    // create a record
    const id = await client.createSession(session);

    // fetch the same record
    const retrievedSession = await client.getSession(id);

    // assert
    expect(id).toEqual(session.sessionId);
    expect(retrievedSession).toEqual(session);

    // update the same record
    const updatedId = await client.updateStepUpStatus(retrievedSession.sessionId!, StepUpStatusEnum.STEP_UP_NOT_REQUIRED);
    const retrieveSettingAfterUpdate = await client.getSession(updatedId);

    // assert
    expect(retrieveSettingAfterUpdate.stepUpStatus).toEqual(StepUpStatusEnum.STEP_UP_NOT_REQUIRED);
    expect(retrieveSettingAfterUpdate.lastUpdateTimestamp).not.toEqual(retrievedSession.lastUpdateTimestamp);

    // delete the same record
    const deletedId = await client.deleteSession(id!);

    // assert
    expect(deletedId).toEqual(session.sessionId);
  });

  it('updates step up status', async () => {
    // instantiate client
    const client = new SessionClient();

    // test setup
    let sessionId;
    const userId = 'user-id';
    const clientId = 'client-id';
    const token = 'dummy token';
    const referrerUrl = 'http://api/path';
    const stepUpStatus = StepUpStatusEnum.STEP_UP_REQUIRED;
    // eslint-disable-next-line prefer-const
    sessionId = await client.createSessionWithParams(sessionId, userId, clientId, token, referrerUrl, stepUpStatus);

    // retrieve session and validate step up status
    let retrievedSession = await client.getSession(sessionId);

    // assert
    expect(retrievedSession.sessionId).toEqual(sessionId);

    // update step up status and retrieve session again
    const updatedSessionId = await client.updateStepUpStatus(retrievedSession.sessionId!, StepUpStatusEnum.STEP_UP_NOT_REQUIRED);
    retrievedSession = await client.getSession(updatedSessionId);

    // assert
    expect(retrievedSession.stepUpStatus).toEqual(StepUpStatusEnum.STEP_UP_NOT_REQUIRED);

    // clean up
    const deletedId = await client.deleteSession(retrievedSession.sessionId!);

    // assert
    expect(deletedId).toEqual(retrievedSession.sessionId);
  });

  it('updates changes step up status to STEP_UP_COMPLETED', async () => {
    // instantiate client
    const client = new SessionClient();

    // test setup
    let sessionId;
    const userId = 'user-id';
    const clientId = 'client-id';
    const token = 'dummy token';
    const referrerUrl = 'http://api/path';
    const stepUpStatus = StepUpStatusEnum.STEP_UP_REQUIRED;
    // eslint-disable-next-line prefer-const
    sessionId = await client.createSessionWithParams(sessionId, userId, clientId, token, referrerUrl, stepUpStatus);

    // retrieve session and validate step up status
    let retrievedSession = await client.getSession(sessionId);

    // assert
    expect(retrievedSession.sessionId).toEqual(sessionId);

    // mark session as STEP_UP_COMPLETED and retrieve session again
    const completedSessionId = await client.completeStepUpRequest(retrievedSession.sessionId!);
    retrievedSession = await client.getSession(completedSessionId);

    // assert
    expect(retrievedSession.stepUpStatus).toEqual(StepUpStatusEnum.STEP_UP_COMPLETED);

    // clean up
    const deletedId = await client.deleteSession(retrievedSession.sessionId!);

    // assert
    expect(deletedId).toEqual(retrievedSession.sessionId);
  });
});
