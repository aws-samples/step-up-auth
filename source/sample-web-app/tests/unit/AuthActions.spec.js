// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Unit coverage for the sign-in step machine. The user pool requires MFA with an authenticator app,
// so a user's first sign-in stops at Cognito's MFA_SETUP challenge (Amplify's
// CONTINUE_SIGN_IN_WITH_TOTP_SETUP step): the app shows the setup key and its QR code, and the first
// code from the authenticator app completes the sign-in. The setup key is a TOTP seed and must never be
// written to the console, and neither may the password.

import { inspect } from 'util';
import {
  AUTH_USER,
  AUTH_MFA,
  AUTH_MFA_SETUP,
  AUTH_ERROR
} from '../../src/actions/Types';

jest.mock('aws-amplify/auth', () => ({
  signIn: jest.fn(),
  confirmSignIn: jest.fn(),
  signOut: jest.fn(),
  signUp: jest.fn(),
  confirmSignUp: jest.fn(),
  resendSignUpCode: jest.fn(),
  resetPassword: jest.fn(),
  confirmResetPassword: jest.fn(),
  getCurrentUser: jest.fn(),
  fetchAuthSession: jest.fn()
}));

jest.mock('../../src/config', () => ({
  __esModule: true,
  default: {}
}));

import { signIn, confirmSignIn, signUp, confirmResetPassword } from 'aws-amplify/auth';
import {
  login,
  confirmLogin,
  setNewPassword,
  register,
  confirmForgotPassword
} from '../../src/actions/AuthActions';

// The actions do not return their promise chains, so flush pending callbacks before asserting.
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const SETUP_KEY = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const PASSWORD = 'Sup3r-Secret-Passw0rd!';
const SETUP_URI = `otpauth://totp/StepUpAuthSample:alice?secret=${SETUP_KEY}&issuer=StepUpAuthSample`;

// The Amplify v6 result for Cognito's MFA_SETUP challenge; getSetupUri returns a URL object.
function totpSetupStep() {
  return {
    isSignedIn: false,
    nextStep: {
      signInStep: 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP',
      totpSetupDetails: {
        sharedSecret: SETUP_KEY,
        getSetupUri: jest.fn(() => new URL(SETUP_URI))
      }
    }
  };
}

const setupAction = {
  type: AUTH_MFA_SETUP,
  payload: { username: 'alice', challengeName: 'MFA_SETUP', sharedSecret: SETUP_KEY, setupUri: SETUP_URI }
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('first sign-in sets up the authenticator app', () => {
  it('login dispatches AUTH_MFA_SETUP with the setup key and the otpauth URI', async () => {
    const output = totpSetupStep();
    signIn.mockResolvedValue(output);
    const dispatch = jest.fn();
    const navigate = jest.fn();

    login({ username: 'alice', password: PASSWORD }, navigate)(dispatch);
    await flushPromises();

    expect(signIn).toHaveBeenCalledWith({ username: 'alice', password: PASSWORD, options: undefined });
    expect(output.nextStep.totpSetupDetails.getSetupUri).toHaveBeenCalledWith('StepUpAuthSample', 'alice');
    expect(dispatch).toHaveBeenCalledWith(setupAction);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a new password continues to the authenticator setup', async () => {
    confirmSignIn.mockResolvedValue(totpSetupStep());
    const dispatch = jest.fn();

    setNewPassword({ cognitoUser: { username: 'alice' }, newPassword: PASSWORD }, jest.fn())(dispatch);
    await flushPromises();

    expect(confirmSignIn).toHaveBeenCalledWith({ challengeResponse: PASSWORD });
    expect(dispatch).toHaveBeenCalledWith(setupAction);
  });

  it('the first authenticator code completes the sign-in', async () => {
    confirmSignIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    const dispatch = jest.fn();
    const navigate = jest.fn();

    confirmLogin({ cognitoUser: { username: 'alice' }, code: '123456', mfaType: 'SOFTWARE_TOKEN_MFA' }, navigate)(dispatch);
    await flushPromises();

    expect(confirmSignIn).toHaveBeenCalledWith({ challengeResponse: '123456' });
    expect(dispatch).toHaveBeenCalledWith({ type: AUTH_USER });
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('a wrong first code reports the error', async () => {
    const err = new Error('Code mismatch and fail enable Software Token MFA');
    err.name = 'EnableSoftwareTokenMFAException';
    confirmSignIn.mockRejectedValue(err);
    const dispatch = jest.fn();

    confirmLogin({ cognitoUser: { username: 'alice' }, code: '000000', mfaType: 'SOFTWARE_TOKEN_MFA' }, jest.fn())(dispatch);
    await flushPromises();

    expect(dispatch).toHaveBeenCalledWith({ type: AUTH_ERROR, payload: err.message });
  });

  it('a later sign-in asks for the authenticator code', async () => {
    signIn.mockResolvedValue({ isSignedIn: false, nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' } });
    const dispatch = jest.fn();

    login({ username: 'alice', password: PASSWORD }, jest.fn())(dispatch);
    await flushPromises();

    expect(dispatch).toHaveBeenCalledWith({
      type: AUTH_MFA,
      payload: { username: 'alice', challengeName: 'SOFTWARE_TOKEN_MFA', signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' }
    });
  });
});

describe('secrets never reach the console', () => {
  it('logs neither the setup key nor the password on any sign-in, registration or reset path', async () => {
    const dispatch = jest.fn();

    // sign-in that stops at the authenticator setup
    signIn.mockResolvedValueOnce(totpSetupStep());
    login({ username: 'alice', password: PASSWORD }, jest.fn())(dispatch);
    await flushPromises();

    // custom auth flow that then stops at the authenticator setup
    signIn.mockResolvedValueOnce({ nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE' } });
    confirmSignIn
      .mockResolvedValueOnce({ nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE' } })
      .mockResolvedValueOnce(totpSetupStep());
    login({ username: 'alice', password: PASSWORD }, jest.fn())(dispatch);
    await flushPromises();

    // new password that then stops at the authenticator setup
    confirmSignIn.mockResolvedValueOnce(totpSetupStep());
    setNewPassword({ cognitoUser: { username: 'alice' }, newPassword: PASSWORD }, jest.fn())(dispatch);
    await flushPromises();

    // the first authenticator code
    confirmSignIn.mockResolvedValueOnce({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    confirmLogin({ cognitoUser: { username: 'alice' }, code: '123456', mfaType: 'SOFTWARE_TOKEN_MFA' }, jest.fn())(dispatch);
    await flushPromises();

    // registration and password reset carry a password too
    signUp.mockResolvedValueOnce({
      isSignUpComplete: false,
      userId: 'user-sub',
      nextStep: { signUpStep: 'CONFIRM_SIGN_UP', codeDeliveryDetails: {} }
    });
    register({ username: 'alice', password: PASSWORD, email: 'alice@example.com', phone: '+12025550100' }, jest.fn())(dispatch);
    await flushPromises();

    confirmResetPassword.mockResolvedValueOnce(undefined);
    confirmForgotPassword({ username: 'alice', code: '111111', newPassword: PASSWORD }, jest.fn())(dispatch);
    await flushPromises();

    // the setup key did reach the store (Login renders it) on all three setup paths...
    expect(dispatch.mock.calls.filter((c) => c[0].type === AUTH_MFA_SETUP)).toHaveLength(3);

    // ...but no console call ever received the setup key or the password
    const logged = [...console.log.mock.calls, ...console.error.mock.calls]
      .map((args) => inspect(args, { depth: null }))
      .join('\n');
    expect(console.log).toHaveBeenCalled();
    expect(logged).not.toContain(SETUP_KEY);
    expect(logged).not.toContain(PASSWORD);
  });
});
