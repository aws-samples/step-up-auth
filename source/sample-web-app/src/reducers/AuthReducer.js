// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  AUTH_USER,
  AUTH_MFA,
  AUTH_MFA_SETUP,
  AUTH_NEW_PASSWORD_REQUIRED,
  UNAUTH_USER,
  REGISTER_USER,
  REGISTER_USER_CONFIRM,
  REGISTER_MFA,
  REGISTER_USER_ERROR,
  FORGOT_PASSWORD,
  FORGOT_PASSWORD_CONFIRM,
  AUTH_ERROR,
  AUTH_ERROR_CLEAR
} from '../actions/Types';

// mfaSetup holds the authenticator setup key (the TOTP seed) while the user sets up their app.
// The state is logged on every transition, so log it without the key.
function withoutSetupKey(obj) {
  return obj && obj.mfaSetup ? { ...obj, mfaSetup: '<redacted>' } : obj;
}

export default function(state = {}, action) {

  switch (action.type) {
    case AUTH_USER: {
      const returnProps = {...state, error: '', authenticated: true, mfa: false, mfaSetup: null};

      console.log('auth_reducer. action: ', action);
      console.log('auth_reducer. returning props: ', withoutSetupKey(returnProps));
      return returnProps;
    }
    case AUTH_MFA: {
      const returnProps = {...state, error: '', authenticated: false, mfa: true, mfaType: action.payload.challengeName, mfaSetup: null, changePassword: false, cognitoUser: action.payload};

      console.log('auth_reducer. action: ', action);
      console.log('auth_reducer. returning props: ', withoutSetupKey(returnProps));
      return returnProps;
    }
    case AUTH_MFA_SETUP: {
      const { username, sharedSecret, setupUri } = action.payload;
      const returnProps = {...state, error: '', authenticated: false, mfa: true, mfaType: 'SOFTWARE_TOKEN_MFA', mfaSetup: { sharedSecret, setupUri }, changePassword: false, cognitoUser: { username }};

      console.log('auth_reducer. action: ', { type: action.type, username });
      console.log('auth_reducer. returning props: ', withoutSetupKey(returnProps));
      return returnProps;
    }
    case AUTH_NEW_PASSWORD_REQUIRED: {
      const returnProps = {...state, error: '', authenticated: false, mfa: false, changePassword: true, cognitoUser: action.payload};

      console.log('auth_reducer. action: ', action);
      console.log('auth_reducer. returning props: ', withoutSetupKey(returnProps));
      return returnProps;
    }
    case UNAUTH_USER: {
      const returnProps = {...state, error: '', authenticated: false, mfaSetup: null};

      console.log('auth_reducer. action: ', action);
      console.log('auth_reducer. returning props: ', withoutSetupKey(returnProps));
      return returnProps;
    }
    case REGISTER_USER: {
      const returnProps = {...state, error: '', authenticated: false, register: true};

      console.log('auth_reducer. action: ', action);
      console.log('auth_reducer. returning props: ', withoutSetupKey(returnProps));
      return returnProps;
    }
    case REGISTER_USER_CONFIRM: {
      const returnProps = {...state, error: '', authenticated: false, register: true, mfa: false, resendCode: false};

      console.log('auth_reducer. action: ', action);
      console.log('auth_reducer. returning props: ', withoutSetupKey(returnProps));
      return returnProps;
    }
    case REGISTER_MFA: {
      const returnProps = {...state, error: '', mfa: true, resendCode: false, cognitoUser: action.payload};

      console.log('auth_reducer. action: ', action);
      console.log('auth_reducer. returning props: ', withoutSetupKey(returnProps));
      return returnProps;
    }
    case REGISTER_USER_ERROR: {
      const returnProps = {...state, error: action.payload, mfa: true, resendCode: true, cognitoUser: action.cognitoUser};

      console.log('auth_reducer. action: ', action);
      console.log('auth_reducer. returning props: ', withoutSetupKey(returnProps));
      return returnProps;
    }
    case AUTH_ERROR: {
      const returnProps = {...state, error: action.payload, authenticated: false};

      console.log('auth_reducer. action: ', action);
      console.log('auth_reducer. returning props: ', withoutSetupKey(returnProps));
      return returnProps;
    }
    case FORGOT_PASSWORD: {
      const returnProps = {...state, error: '', forgotPasswordCode: true, authenticated: false};

      console.log('auth_reducer. action: ', action);
      console.log('auth_reducer. returning props: ', withoutSetupKey(returnProps));
      return returnProps;
    }
    case FORGOT_PASSWORD_CONFIRM: {
      const returnProps = {...state, error: '', forgotPasswordCode: false, authenticated: false};

      console.log('auth_reducer. action: ', action);
      console.log('auth_reducer. returning props: ', withoutSetupKey(returnProps));
      return returnProps;
    }
    case AUTH_ERROR_CLEAR: {
      const returnProps = {...state, error: '', authenticated: false};

      console.log('auth_reducer. action: ', action);
      console.log('auth_reducer. returning props: ', withoutSetupKey(returnProps));
      return returnProps;
    }
  }

  return state;
}
