// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Unit coverage for the authenticator setup state. AUTH_MFA_SETUP keeps the setup key and its otpauth
// URI in the store while the Login screen shows them; completing or leaving the sign-in clears them.
// The reducer logs every transition, and the setup key must never be part of that output.

import { inspect } from 'util';
import {
  AUTH_USER,
  AUTH_MFA,
  AUTH_MFA_SETUP,
  UNAUTH_USER,
  AUTH_ERROR,
  AUTH_ERROR_CLEAR
} from '../../src/actions/Types';
import authReducer from '../../src/reducers/AuthReducer';

const SETUP_KEY = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const SETUP_URI = `otpauth://totp/StepUpAuthSample:alice?secret=${SETUP_KEY}&issuer=StepUpAuthSample`;

const setupAction = {
  type: AUTH_MFA_SETUP,
  payload: { username: 'alice', challengeName: 'MFA_SETUP', sharedSecret: SETUP_KEY, setupUri: SETUP_URI }
};

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AUTH_MFA_SETUP', () => {
  it('stores the setup key and URI and shows the code form', () => {
    const state = authReducer({ error: 'old error', changePassword: true }, setupAction);

    expect(state).toEqual({
      error: '',
      authenticated: false,
      mfa: true,
      mfaType: 'SOFTWARE_TOKEN_MFA',
      mfaSetup: { sharedSecret: SETUP_KEY, setupUri: SETUP_URI },
      changePassword: false,
      cognitoUser: { username: 'alice' }
    });
  });

  it('keeps the setup key on a wrong code so the user can retry', () => {
    const state = authReducer(authReducer({}, setupAction), { type: AUTH_ERROR, payload: 'Code mismatch' });

    expect(state.mfaSetup).toEqual({ sharedSecret: SETUP_KEY, setupUri: SETUP_URI });
    expect(state.error).toBe('Code mismatch');
  });

  it.each([
    ['AUTH_USER', { type: AUTH_USER }],
    ['AUTH_MFA', { type: AUTH_MFA, payload: { username: 'alice', challengeName: 'SOFTWARE_TOKEN_MFA' } }],
    ['UNAUTH_USER', { type: UNAUTH_USER }]
  ])('%s clears the setup key', (_name, action) => {
    const state = authReducer(authReducer({}, setupAction), action);

    expect(state.mfaSetup).toBeNull();
  });

  it('never logs the setup key', () => {
    let state = authReducer({}, setupAction);
    state = authReducer(state, { type: AUTH_ERROR, payload: 'Code mismatch' });
    state = authReducer(state, { type: AUTH_ERROR_CLEAR });
    authReducer(state, { type: AUTH_USER });

    const logged = console.log.mock.calls.map((args) => inspect(args, { depth: null })).join('\n');
    expect(console.log).toHaveBeenCalled();
    expect(logged).not.toContain(SETUP_KEY);
  });
});
