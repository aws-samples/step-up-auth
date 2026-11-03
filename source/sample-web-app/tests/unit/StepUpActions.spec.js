// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Unit coverage for the two-stage step-up re-authentication flow. The flow must work for SMS MFA,
// where the one-time code is delivered only after Cognito creates the challenge: stage 1 (password)
// drives sign-in to the MFA challenge and renders the code input; stage 2 (code) confirms the pending
// Amplify flow without a new signOut/signIn and then calls /respond-to-challenge.

import {
  STEP_UP_ERROR,
  STEP_UP_REAUTH_USERNAME,
  STEP_UP_REAUTH_MFA_REQUIRED,
  STEP_UP_COMPLETED,
  UNAUTH_USER
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
import { transfer } from '../../src/actions/TransferActions';

// transfer()/info() do not return their promise chain, so flush pending microtasks before asserting.
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

// Build a Cognito error with the name Amplify sets, which drives re-auth error classification.
function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

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

describe('step-up re-authentication - password retry survives a wrong password', () => {
  it('reaches the MFA stage on retry using the remembered username even with no session tokens', async () => {
    // mirror the reducer: remember the username the action stores, so the retry can read it
    const stepUpState = { challengeId: 'challenge-123' };
    const getStateLocal = () => ({ stepUp: stepUpState });
    const dispatch = jest.fn((action) => {
      if (action.type === STEP_UP_REAUTH_USERNAME) {
        stepUpState.reauthUsername = action.payload.username;
      }
    });

    // first attempt: a live session supplies the username, Cognito rejects the wrong password
    fetchAuthSession.mockResolvedValueOnce(sessionWithUser('alice'));
    signIn.mockRejectedValueOnce(namedError('NotAuthorizedException', 'Incorrect username or password.'));

    await stepUpReauthStart(false, 'wrong')(dispatch, getStateLocal);

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: STEP_UP_ERROR }));
    expect(stepUpState.reauthUsername).toBe('alice');

    // second attempt: signOut emptied the session, so the username must come from state
    fetchAuthSession.mockResolvedValueOnce({ tokens: undefined });
    signIn.mockResolvedValueOnce({ nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_SMS_CODE' } });

    await stepUpReauthStart(false, 'secret')(dispatch, getStateLocal);

    expect(signIn).toHaveBeenLastCalledWith({ username: 'alice', password: 'secret' });
    expect(dispatch).toHaveBeenCalledWith({
      type: STEP_UP_REAUTH_MFA_REQUIRED,
      payload: { mfaType: 'SMS_MFA' }
    });
  });

  it('never stores the password in any dispatched action', async () => {
    signIn.mockResolvedValue({ nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_SMS_CODE' } });
    const dispatch = jest.fn();

    await stepUpReauthStart(false, 'super-secret-password')(dispatch, getState);

    expect(JSON.stringify(dispatch.mock.calls)).not.toContain('super-secret-password');
  });
});

describe('step-up re-authentication - MFA code retry and reset', () => {
  it('keeps the code stage on a wrong code (CodeMismatchException), then completes on the correct code', async () => {
    confirmSignIn.mockRejectedValueOnce(namedError('CodeMismatchException', 'Invalid code.'));
    const dispatch = jest.fn();

    await stepUpReauthConfirm(false, '000000')(dispatch, getState);

    const errorCall = dispatch.mock.calls.find((c) => c[0].type === STEP_UP_ERROR);
    expect(errorCall).toBeDefined();
    // a wrong code must not return the flow to the password stage
    expect(errorCall[0].payload.resetMfa).toBeFalsy();
    expect(post).not.toHaveBeenCalled();

    // the user retries with the correct code against the same open challenge
    confirmSignIn.mockResolvedValueOnce({ nextStep: { signInStep: 'DONE' } });
    mockPostOnce('transfer stepped-up');
    const dispatch2 = jest.fn();

    await stepUpReauthConfirm(false, '654321')(dispatch2, getState);

    expect(post).toHaveBeenCalledTimes(1);
    expect(dispatch2).toHaveBeenCalledWith(expect.objectContaining({ type: STEP_UP_COMPLETED }));
  });

  it('returns to the password stage when the pending sign-in session is no longer valid', async () => {
    confirmSignIn.mockRejectedValueOnce(
      namedError('NotAuthorizedException', 'Invalid session for the user, session is expired.')
    );
    const dispatch = jest.fn();

    await stepUpReauthConfirm(false, '654321')(dispatch, getState);

    expect(post).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      type: STEP_UP_ERROR,
      payload: expect.objectContaining({ resetMfa: true })
    });
  });
});

describe('protected API with no session', () => {
  it('transfer dispatches UNAUTH_USER when there is no current user', async () => {
    fetchAuthSession.mockResolvedValue({ tokens: undefined });
    const dispatch = jest.fn();

    transfer(false)(dispatch, getState);
    await flushPromises();

    expect(dispatch).toHaveBeenCalledWith({ type: UNAUTH_USER });
  });
});
