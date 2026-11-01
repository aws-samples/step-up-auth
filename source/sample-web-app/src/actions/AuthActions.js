// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  signIn,
  confirmSignIn,
  signOut,
  signUp,
  confirmSignUp,
  resendSignUpCode,
  resetPassword,
  confirmResetPassword,
  getCurrentUser,
  fetchAuthSession
} from 'aws-amplify/auth';
import {
  AUTH_USER,
  AUTH_MFA,
  AUTH_NEW_PASSWORD_REQUIRED,
  UNAUTH_USER,
  REGISTER_USER,
  REGISTER_USER_CONFIRM,
  REGISTER_MFA,
  REGISTER_USER_ERROR,
  FORGOT_PASSWORD,
  FORGOT_PASSWORD_CONFIRM,
  AUTH_ERROR
} from './Types';
import config from '../config';

export function authError(error) {
  return {
    type: AUTH_ERROR,
    payload: error.message
  };
}

// sign-in options: custom auth flow when configured (Amplify v6 has no global
// authenticationFlowType setting; it is passed per signIn() call)
function signInOptions() {
  return config.AWS_COGNITO_CUSTOM_AUTH ? { authFlowType: 'CUSTOM_WITH_SRP' } : undefined;
}

// Cognito - signIn(). Amplify v6 rejects a sign-in while a user is already
// signed in (Amplify v4 did not), so sign out and retry once in that case.
function signInWithRetry(username, password, retried) {
  return signIn({ username, password, options: signInOptions() })
    .catch(err => {
      if (!retried && err && err.name === 'UserAlreadyAuthenticatedException') {
        console.log('actions.login(): user already authenticated, signing out and retrying');
        return signOut().then(() => signInWithRetry(username, password, true));
      }
      throw err;
    });
}

// Inspect the Amplify v6 sign-in result (nextStep.signInStep) and dispatch the
// same actions (and payload shapes) the Amplify v4 challengeName checks did:
// 1. sign-in complete, dispatch -> AUTH_USER
// 2. New Password is required (change 'FORCE_CHANGE_PASSWORD' to 'CONFIRMED'),
//    dispatch -> AUTH_NEW_PASSWORD_REQUIRED
// 3. MFA confirmation is required, dispatch -> AUTH_MFA
// 4. Handle custom auth flow 'CUSTOM_CHALLENGE'
function handleSignInStep(output, ctx) {
  const { username, dispatch, navigate } = ctx;
  const nextStep = (output && output.nextStep) || {};
  const signInStep = nextStep.signInStep;
  console.log('actions.handleSignInStep(): signInStep:', signInStep);

  switch (signInStep) {
    case 'DONE':
      // dispatch AUTH_USER
      dispatch({ type: AUTH_USER });

      // we have authenticated, lets navigate to /main route
      navigate('/');
      return Promise.resolve();
    case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
      dispatch({ type: AUTH_NEW_PASSWORD_REQUIRED, payload: { username, challengeName: 'NEW_PASSWORD_REQUIRED' } });
      return Promise.resolve();
    case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
      dispatch({ type: AUTH_MFA, payload: { username, challengeName: 'SOFTWARE_TOKEN_MFA', signInStep } });
      return Promise.resolve();
    case 'CONFIRM_SIGN_IN_WITH_SMS_CODE':
      dispatch({ type: AUTH_MFA, payload: { username, challengeName: 'SMS_MFA', signInStep } });
      return Promise.resolve();
    case 'CONTINUE_SIGN_IN_WITH_MFA_SELECTION': {
      // user has both SMS and TOTP enabled without a preferred one: pick TOTP when allowed
      const allowedMFATypes = nextStep.allowedMFATypes || [];
      const challengeResponse = allowedMFATypes.includes('TOTP') ? 'TOTP' : 'SMS';
      return confirmSignIn({ challengeResponse })
        .then(next => handleSignInStep(next, ctx));
    }
    case 'CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE': {
      if (ctx.customChallengeAnswered) {
        dispatch(authError('Custom Auth'));
        return Promise.resolve();
      }
      const challengeResponse = '5';
      return confirmSignIn({ challengeResponse })
        .then(data1 => {
          console.log('confirmSignIn (custom challenge) data:', data1);

          const challengeResponse2 = '10';
          return confirmSignIn({ challengeResponse: challengeResponse2 });
        })
        .then(data2 => {
          console.log('confirmSignIn (custom challenge) data:', data2);
          return handleSignInStep(data2, { ...ctx, customChallengeAnswered: true });
        })
        .catch(err => {
          console.log('confirmSignIn (custom challenge) error:', err);
          dispatch(authError('Custom Auth'));
        });
    }
    case 'CONFIRM_SIGN_UP':
      dispatch(authError({ message: 'User is not confirmed.' }));
      return Promise.resolve();
    default:
      dispatch(authError({ message: `Unsupported sign-in step: ${signInStep}` }));
      return Promise.resolve();
  }
}

// Cognito - signIn()
export function login({ username, password }, navigate) {
  return function(dispatch) {
    console.log('actions.login(): username password:', { username, password });

    // signIn (cognito)
    signInWithRetry(username, password, false)
      .then(data => {
        console.log('actions.login():signIn() data:', data);
        return handleSignInStep(data, { username, dispatch, navigate });
      })
      .catch(err => {
        console.error('actions.login():signIn() err:', err);
        // error -- invoke authError which dispatches AUTH_ERROR
        dispatch(authError(err));
      });
  };
}

// Cognito - getCurrentUser()
// Cognito - fetchAuthSession()
// This is a pass-through function to indicate that user has already authenticated
// and has a valid Amplify session.
export function validateUserSession() {
  return function(dispatch) {
    console.log('actions.validateUserSession()');

    getCurrentUser()
      .then(currentAuthUser => {
        console.log('actions.validateUserSession():getCurrentUser() currentAuthUser:', currentAuthUser);
        // grab the user session (fetchAuthSession() refreshes expired tokens)
        fetchAuthSession()
          .then(session => {
            console.log('actions.validateUserSession():fetchAuthSession() session:', session);
            // tokens are only present when the session is valid
            // otherwise, dispatch AUTH_USER success action and by-pass login screen
            if (session && session.tokens) {
              // fire user is authenticated
              dispatch({ type: AUTH_USER });
            } else {
              // fire user is unauthenticated
              dispatch({ type: UNAUTH_USER });
            }
          })
          .catch(err => {
            console.error('actions.validateUserSession():fetchAuthSession() err:', err);
            // error occured during session validation, fire user is unauthenticated
            dispatch({ type: UNAUTH_USER });
          });
      })
      .catch(err => {
        console.error('actions.validateUserSession():getCurrentUser() err:', err);
        // error occured while retrieving current auth user, fire user is unauthenticated
        dispatch({ type: UNAUTH_USER });
      });
  };
}

// Cognito - confirmSignIn() with the new password
export function setNewPassword({ cognitoUser, newPassword }, navigate) {
  return function(dispatch) {
    console.log('actions.setNewPassword(): cognitoUSer, newPassword:', { cognitoUser, newPassword });
    const username = cognitoUser && cognitoUser.username;

    // confirmSignIn (cognito)
    confirmSignIn({ challengeResponse: newPassword })
      .then(data => {
        console.log('actions.setNewPassword():confirmSignIn() data: ', data);

        // inspect response 'data' and check whether
        // 1. MFA confirmation is required, dispatch->AUTH_MFA
        // 2. otherwise, authenticate user, dispatch -> AUTH_USER
        return handleSignInStep(data, { username, dispatch, navigate });
      })
      .catch(err => {
        console.error('actions.setNewPassword():confirmSignIn() err:', err);
        // error -- invoke authError which dispatches AUTH_ERROR
        dispatch(authError(err));
      });
  };
}

// Cognito - signOut()
export function logout(navigate) {
  return function(dispatch) {
    console.log('actions.logout()');

    // signOut (cognito)
    signOut()
      .then( data => {
        console.log('actions.logout():signOut() data:', data);

        dispatch({ type: UNAUTH_USER });

        // we have authenticated, lets navigate to /main route
        navigate('/');
      })
      .catch(err => {
        console.error('actions.logout():signOut() err:', err);
        // error -- invoke authError which dispatches AUTH_ERROR
        dispatch(authError(err));
      });
  };
}

// Cognito - confirmSignIn() with the MFA code
export function confirmLogin( { cognitoUser, code, mfaType }, navigate) {
  return function(dispatch) {
    console.log('actions.confirmLogin(): cognitoUSer, code, mfaType:', { cognitoUser, code, mfaType });
    const username = cognitoUser && cognitoUser.username;

    // confirmSignIn (cognito)
    confirmSignIn({ challengeResponse: code })
      .then( data => {
        console.log('actions.confirmLogin():confirmSignIn() data: ', data);
        return handleSignInStep(data, { username, dispatch, navigate });
      })
      .catch(err => {
        console.error('actions.confirmLogin():confirmSignIn() err:', err);
        // error -- invoke authError which dispatches AUTH_ERROR
        dispatch(authError(err));
      });
  };
}

// Cognito - signUp()
export function register( { username, password, email, phone }, navigate) {
  return function(dispatch) {
    console.log('actions.register(): username, password, email, phone: ', { username, password, email, phone });

    const userAttributes = { email, ...(phone ? { phone_number: phone } : {}) };

    // signUp (cognito)
    signUp({ username, password, options: { userAttributes } })
      .then( data => {
        console.log('actions.register():signUp() data:', data);

        // MFA is required for user registration
        if (data && data.nextStep && data.nextStep.signUpStep === 'CONFIRM_SIGN_UP') {
          // same payload shape as the Amplify v4 ISignUpResult the Register screen reads
          dispatch({
            type: REGISTER_MFA,
            payload: {
              user: { username },
              userConfirmed: data.isSignUpComplete,
              userSub: data.userId,
              codeDeliveryDetails: data.nextStep.codeDeliveryDetails
            }
          });
        } else {
          dispatch({ type: REGISTER_USER });

          // user registration successful, lets navigate to / route
          navigate('/');
        }
      })
      .catch( err => {
        console.error('actions.register():signUp() err:', err);

        // error -- invoke authError which dispatches REGISTER_USER_ERROR
        dispatch(authError(err));
      });
  };
}

// Cognito - confirmSignUp()
export function confirmRegistration( { cognitoUser, code }, navigate) {
  return function(dispatch) {
    console.log('actions.confirmRegistration(): cognitoUSer, code:', { cognitoUser, code });
    const { username } = cognitoUser.user;

    // confirmSignUp (cognito)
    confirmSignUp({ username, confirmationCode: code })
      .then( data => {
        console.log('actions.confirmRegistration():confirmSignUp() data: ', data);

        // A successful registration response doesnt contain idToken.
        // So we must redirect to login screen

        // dispatch REGISTER_USER_CONFIRM
        dispatch({ type: REGISTER_USER_CONFIRM });

        // we have authenticated, lets navigate to /main route
        navigate('/');
      })
      .catch( err => {
        console.error('actions.confirmRegistration():confirmSignUp() err:', err);

        // error -- invoke authError which dispatches AUTH_ERROR
        //dispatch(authError(err));
        dispatch({ type: REGISTER_USER_ERROR, payload: err.message, cognitoUser });
      });
  };
}

// Cognito - resendSignUpCode()
export function resendConfirmationCode( { cognitoUser } ) {
  return function(dispatch) {
    console.log('actions.resendConfirmationCode(): username: ', { cognitoUser });
    const { username } = cognitoUser.user;

    // resendSignUpCode (cognito)
    resendSignUpCode({ username })
      .then( data => {
        console.log('actions.resendConfirmationCode():resendSignUpCode() data:', data);

        dispatch({ type: REGISTER_MFA, payload: cognitoUser });

      })
      .catch( err => {
        console.error('actions.resendConfirmationCode():resendSignUpCode() err:', err);

        // error -- invoke authError which dispatches AUTH_ERROR
        dispatch(authError(err));
      });
  };
}


// Cognito - resetPassword()
export function forgotPassword( { username } ) {
  return function(dispatch) {
    console.log('actions.forgotPassword(): username: ', { username });

    // resetPassword (cognito)
    resetPassword({ username })
      .then( data => {
        console.log('actions.forgotPassword():resetPassword() data:', data);

        dispatch({ type: FORGOT_PASSWORD });
      })
      .catch( err => {
        console.error('actions.forgotPassword():resetPassword() err:', err);

        // error -- invoke authError which dispatches AUTH_ERROR
        dispatch(authError(err));
      });
  };
}


// Cognito - confirmResetPassword()
export function confirmForgotPassword( { username, code, newPassword }, navigate) {
  return function(dispatch) {
    console.log('actions.confirmForgotPassword(): username, code, newPassword: ', { username, code, newPassword });

    // confirmResetPassword (cognito)
    confirmResetPassword({ username, confirmationCode: code, newPassword })
      .then( data => {
        console.log('actions.confirmForgotPassword():confirmResetPassword() data:', data);
        // TODO - User password changed successfully, do we need to login again?
        dispatch({ type: FORGOT_PASSWORD_CONFIRM });

        navigate('/');
      })
      .catch( err => {
        console.error('actions.confirmForgotPassword():confirmResetPassword() err:', err);

        // error -- invoke authError which dispatches AUTH_ERROR
        dispatch(authError(err));
      });
  };
}
