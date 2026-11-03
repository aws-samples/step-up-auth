// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Unit coverage for the two-stage step-up re-authentication flow. The flow must work for SMS MFA,
// where the one-time code is delivered only after Cognito creates the challenge: stage 1 (password)
// drives sign-in to the MFA challenge and renders the code input; stage 2 (code) confirms the pending
// Amplify flow without a new signOut/signIn and then calls /respond-to-challenge.

import {
  STEP_UP_ERROR,
  STEP_UP_REAUTH_MFA_REQUIRED,
  STEP_UP_COMPLETED
} from '../../src/actions/Types';

jest.mock('aws-amplify/auth', () => ({
  signIn: jest.fn(),
  signOut: jest.fn(),
  confirmSignIn: jest.fn(),
  fetchAuthSession: jest.fn()
}));

jest.mock('aws-amplify/api', () => ({
  post: jest.fn()
}));

jest.mock('../../src/config', () => ({
  __esModule: true,
  default: { REST_API_ENDPOINTS: [{ name: 'stepup-api' }] }
}));

import { signIn, signOut, confirmSignIn, fetchAuthSession } from 'aws-amplify/auth';
import { post } from 'aws-amplify/api';
import { stepUpReauthStart, stepUpReauthConfirm } from '../../src/actions/StepUpActions';

// A fetchAuthSession result that both stage 1 (reads payload.username) and getSessionTokens
// (reads accessToken/idToken toString()) accept.
function sessionWithUser(username) {
  return {
    tokens: {
      accessToken: { toString: () => 'access-jwt', payload: { username } },
      idToken: { toString: () => 'id-jwt', payload: { 'cognito:username': username } }
    }
  };
}

// post({...}).response resolves to { body } whose json() yields the API payload.
function mockPostOnce(details) {
  post.mockReturnValueOnce({
    response: Promise.resolve({ body: { json: () => Promise.resolve({ details }) } })
  });
}

const getState = () => ({ stepUp: { challengeId: 'challenge-123' } });

beforeEach(() => {
  jest.clearAllMocks();
  fetchAuthSession.mockResolvedValue(sessionWithUser('alice'));
  signOut.mockResolvedValue(undefined);
});

describe('step-up re-authentication - direct SMS MFA', () => {
  it('stage 1 renders the code input without confirming a pre-challenge code', async () => {
    signIn.mockResolvedValue({ nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_SMS_CODE' } });
    const dispatch = jest.fn();

    await stepUpReauthStart(false, 'secret')(dispatch, getState);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith({ username: 'alice', password: 'secret' });
    // the SMS code does not exist yet, so stage 1 must NOT call confirmSignIn
    expect(confirmSignIn).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      type: STEP_UP_REAUTH_MFA_REQUIRED,
      payload: { mfaType: 'SMS_MFA' }
    });
  });

  it('stage 2 confirms the delivered code and completes step-up with the challengeId', async () => {
    confirmSignIn.mockResolvedValue({ nextStep: { signInStep: 'DONE' } });
    mockPostOnce('transfer stepped-up');
    const dispatch = jest.fn();

    await stepUpReauthConfirm(false, '654321')(dispatch, getState);

    // confirms the pending Amplify flow; no new signOut/signIn
    expect(confirmSignIn).toHaveBeenCalledWith({ challengeResponse: '654321' });
    expect(signOut).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();

    const postArgs = post.mock.calls[0][0];
    expect(postArgs.path).toBe('/respond-to-challenge');
    expect(postArgs.options.body).toEqual({ challengeId: 'challenge-123' });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: STEP_UP_COMPLETED }));
  });
});

describe('step-up re-authentication - MFA selection resolving to SMS', () => {
  it('selects the factor, then renders the code input without confirming a pre-challenge code', async () => {
    signIn.mockResolvedValue({
      nextStep: { signInStep: 'CONTINUE_SIGN_IN_WITH_MFA_SELECTION', allowedMFATypes: ['SMS'] }
    });
    // selecting SMS triggers code delivery and returns the SMS code challenge
    confirmSignIn.mockResolvedValueOnce({ nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_SMS_CODE' } });
    const dispatch = jest.fn();

    await stepUpReauthStart(false, 'secret')(dispatch, getState);

    // exactly one confirmSignIn: the factor selection, never a code value
    expect(confirmSignIn).toHaveBeenCalledTimes(1);
    expect(confirmSignIn).toHaveBeenCalledWith({ challengeResponse: 'SMS' });
    expect(post).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      type: STEP_UP_REAUTH_MFA_REQUIRED,
      payload: { mfaType: 'SMS_MFA' }
    });
  });
});

describe('step-up re-authentication - TOTP MFA', () => {
  it('stage 1 renders the authenticator code input', async () => {
    signIn.mockResolvedValue({ nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' } });
    const dispatch = jest.fn();

    await stepUpReauthStart(false, 'secret')(dispatch, getState);

    expect(confirmSignIn).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      type: STEP_UP_REAUTH_MFA_REQUIRED,
      payload: { mfaType: 'SOFTWARE_TOKEN_MFA' }
    });
  });
});

describe('step-up re-authentication - failures fail closed', () => {
  it('stage 2 dispatches an error when the sign-in does not complete', async () => {
    confirmSignIn.mockResolvedValue({ nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_SMS_CODE' } });
    const dispatch = jest.fn();

    await stepUpReauthConfirm(false, 'wrong')(dispatch, getState);

    expect(post).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: STEP_UP_ERROR }));
  });

  it('stage 1 dispatches an error for an unsupported sign-in step', async () => {
    signIn.mockResolvedValue({ nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' } });
    const dispatch = jest.fn();

    await stepUpReauthStart(false, 'secret')(dispatch, getState);

    expect(post).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: STEP_UP_ERROR }));
  });
});
