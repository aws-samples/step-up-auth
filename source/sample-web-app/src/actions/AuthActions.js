// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Auth } from 'aws-amplify';
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

// configure auth for custom auth flow
if (config.AWS_COGNITO_CUSTOM_AUTH) {
  Auth.configure({
    authenticationFlowType: 'CUSTOM_AUTH'
  });
}

export function authError(error) {
  return {
    type: AUTH_ERROR,
    payload: error.message
  };
}

// Cognito - Auth.signIn()
export function login({ username, password }, navigate) {
  return function(dispatch) {
    console.log('actions.login(): username password:', { username, password });

    // signIn (cognito)
    Auth.signIn(username, password)
      .then(data => {
        // success -- dispatch AUTH_USER
        console.log('actions.login():Auth.signIn() data:', data);

        // inspect response 'data' and check whether
        // 1. MFA confirmation is required, dispatch->AUTH_MFA
        // 2. New Password is required (change 'FORCE_CHANGE_PASSWORD'
        //    to 'CONFIRMED'), dispatch-> AUTH_NEW_PASSWORD_REQUIRED with payload
        // 3. Handle custom auth flow 'CUSTOM_CHALLENGE'
        // 4. otherwise, authenticate user, dispatch -> AUTH_USER
        if (data.challengeName === 'NEW_PASSWORD_REQUIRED') {
          dispatch({ type: AUTH_NEW_PASSWORD_REQUIRED, payload: data });
        } else if (data.challengeName === 'MFA_REQUIRED' || data.challengeName === 'SMS_MFA' || data.challengeName === 'SOFTWARE_TOKEN_MFA') {
          dispatch({ type: AUTH_MFA, payload: data });
        } else if (data.challengeName === 'CUSTOM_CHALLENGE') {
          const challengeResponse = '5';
          Auth.sendCustomChallengeAnswer(data, challengeResponse)
            .then(data1 => {
              console.log('Auth.sendCustomChallengeAnswer data:', data1);
              // dispatch AUTH_USER
              // dispatch({ type: AUTH_USER });

              // we have authenticated, lets navigate to /main route
              const challengeResponse2 = '10';
              Auth.sendCustomChallengeAnswer(data, challengeResponse2)
                .then(data2 => {
                  console.log('Auth.sendCustomChallengeAnswer data:', data2);
                  // dispatch AUTH_USER
                  dispatch({ type: AUTH_USER });

                  // we have authenticated, lets navigate to /main route
                  navigate('/');
                })
                .catch(err2 => {
                  console.log('Auth.sendCustomChallengeAnswer error:', err2);
                  dispatch(authError('Custom Auth'));
                });
            })
            .catch(err1 => {
              console.log('Auth.sendCustomChallengeAnswer error:', err1);
              dispatch(authError('Custom Auth'));
            });
        } else {
          // dispatch AUTH_USER
          dispatch({ type: AUTH_USER });

          // we have authenticated, lets navigate to /main route
          navigate('/');
        }
      })
      .catch(err => {
        console.error('actions.login():Auth.signIn() err:', err);
        // error -- invoke authError which dispatches AUTH_ERROR
        dispatch(authError(err));
      });
  };
}

// Cognito - Auth.currentAuthenticatedUser()
// Cognito - Auth.userSession()
// This is a pass-through function to indicate that user has already authenticated
// and has a valid Amplify session.
export function validateUserSession() {
  return function(dispatch) {
    console.log('actions.validateUserSession()');

    Auth.currentAuthenticatedUser()
      .then(currentAuthUser => {
        console.log('actions.validateUserSession():Auth.currentAuthenticatedUser() currentAuthUser:', currentAuthUser);
        // grab the user session
        Auth.userSession(currentAuthUser)
          .then(session => {
            console.log('actions.validateUserSession():Auth.userSession() session:', session);
            // finally invoke isValid() method on session to check if auth tokens are valid
            // if tokens have expired, lets call "logout"
            // otherwise, dispatch AUTH_USER success action and by-pass login screen
            if (session.isValid()) {
              // fire user is authenticated
              dispatch({ type: AUTH_USER });
            } else {
              // fire user is unauthenticated
              dispatch({ type: UNAUTH_USER });
            }
          })
          .catch(err => {
            console.error('actions.validateUserSession():Auth.userSession() err:', err);
            // error occured during session validation, fire user is unauthenticated
            dispatch({ type: UNAUTH_USER });
          });
      })
      .catch(err => {
        console.error('actions.validateUserSession():Auth.currentAuthenticatedUser() err:', err);
        // error occured while retrieving current auth user, fire user is unauthenticated
        dispatch({ type: UNAUTH_USER });
      });
  };
}

// Cognito - Auth.completeNewPassword()
export function setNewPassword({ cognitoUser, newPassword }, navigate) {
  return function(dispatch) {
    console.log('actions.setNewPassword(): cognitoUSer, newPassword:', { cognitoUser, newPassword });

    // completeNewPassword (cognito)
    Auth.completeNewPassword(cognitoUser, newPassword)
      .then(data => {
        console.log('actions.setNewPassword():Auth.completeNewPassword() data: ', data);

        // inspect response 'data' and check whether
        // 1. MFA confirmation is required, dispatch->AUTH_MFA
        // 2. otherwise, authenticate user, dispatch -> AUTH_USER
        if (data.challengeName === 'SMS_MFA') {
          dispatch({ type: AUTH_MFA, payload: data });
        } else {
          // dispatch AUTH_USER
          dispatch({ type: AUTH_USER });

          // we have authenticated, lets navigate to /main route
          navigate('/');
        }
      })
      .catch(err => {
        console.error('actions.setNewPassword():Auth.completeNewPassword() err:', err);
        // error -- invoke authError which dispatches AUTH_ERROR
        dispatch(authError(err));
      });
  };
}

// Cognito - Auth.signOut()
export function logout(navigate) {
  return function(dispatch) {
    console.log('actions.logout()');

    // signOut (cognito)
    Auth.signOut()
      .then( data => {
        console.log('actions.logout():Auth.signOut() data:', data);

        dispatch({ type: UNAUTH_USER });

        // we have authenticated, lets navigate to /main route
        navigate('/');
      })
      .catch(err => {
        console.error('actions.logout():Auth.signOut() err:', err);
        // error -- invoke authError which dispatches AUTH_ERROR
        dispatch(authError(err));
      });
  };
}

// Cognito - Auth.confirmSignIn()
export function confirmLogin( { cognitoUser, code, mfaType }, navigate) {
  return function(dispatch) {
    console.log('actions.confirmLogin(): cognitoUSer, code:', { cognitoUser, code });

    // confirmSignIn (cognito)
    Auth.confirmSignIn(cognitoUser, code, mfaType)
      .then( data => {
        console.log('actions.confirmLogin():Auth.confirmSignIn() data: ', data);

        // dispatch AUTH_USER
        dispatch({ type: AUTH_USER });

        // we have authenticated, lets navigate to /main route
        navigate('/');
      })
      .catch(err => {
        console.error('actions.confirmLogin():Auth.confirmSignIn() err:', err);
        // error -- invoke authError which dispatches AUTH_ERROR
        dispatch(authError(err));
      });
  };
}

// Cognito - Auth.signUp()
export function register( { username, password, email, phone }, navigate) {
  return function(dispatch) {
    console.log('actions.register(): username, password, email, phone: ', { username, password, email, phone });

    // signUp (cognito)
    Auth.signUp(username, password, email, phone)
      .then( data => {
        console.log('actions.register():Auth.signUp() data:', data);

        // MFA is required for user registration
        if (typeof data.userConfirmed != 'undefined' && data.userConfirmed == false) {
          dispatch({ type: REGISTER_MFA, payload: data});
        } else {
          dispatch({ type: REGISTER_USER });

          // user registration successful, lets navigate to / route
          navigate('/');
        }
      })
      .catch( err => {
        console.error('actions.register():Auth.signUp() err:', err);

        // error -- invoke authError which dispatches REGISTER_USER_ERROR
        dispatch(authError(err));
      });
  };
}

// Cognito - Auth.confirmSignUp()
export function confirmRegistration( { cognitoUser, code }, navigate) {
  return function(dispatch) {
    console.log('actions.confirmRegistration(): cognitoUSer, code:', { cognitoUser, code });
    const { username } = cognitoUser.user;

    // confirmSignUp (cognito)
    Auth.confirmSignUp(username, code)
      .then( data => {
        console.log('actions.confirmRegistration():Auth.confirmSignUp() data: ', data);

        // A successful registration response doesnt contain idToken.
        // So we must redirect to login screen

        // dispatch REGISTER_USER_CONFIRM
        dispatch({ type: REGISTER_USER_CONFIRM });

        // we have authenticated, lets navigate to /main route
        navigate('/');
      })
      .catch( err => {
        console.error('actions.confirmRegistration():Auth.confirmSignUp() err:', err);

        // error -- invoke authError which dispatches AUTH_ERROR
        //dispatch(authError(err));
        dispatch({ type: REGISTER_USER_ERROR, payload: err.message, cognitoUser });
      });
  };
}

// Cognito - Auth.resendSignUp()
export function resendConfirmationCode( { cognitoUser } ) {
  return function(dispatch) {
    console.log('actions.resendConfirmationCode(): username: ', { cognitoUser });
    const { username } = cognitoUser.user;

    // resendSignUp (cognito)
    Auth.resendSignUp(username)
      .then( data => {
        console.log('actions.resendConfirmationCode():Auth.resendSignUp() data:', data);

        dispatch({ type: REGISTER_MFA, payload: cognitoUser });

      })
      .catch( err => {
        console.error('actions.confirmForgotPassword():Auth.forgotPasswordSubmit() err:', err);

        // error -- invoke authError which dispatches AUTH_ERROR
        dispatch(authError(err));
      });
  };
}


// Cognito - Auth.forgotPassword()
export function forgotPassword( { username } ) {
  return function(dispatch) {
    console.log('actions.forgotPassword(): username: ', { username });

    // forgotPassword (cognito)
    Auth.forgotPassword(username)
      .then( data => {
        console.log('actions.forgotPassword():Auth.forgotPassword() data:', data);

        dispatch({ type: FORGOT_PASSWORD });
      })
      .catch( err => {
        console.error('actions.forgotPassword():Auth.forgotPassword() err:', err);

        // error -- invoke authError which dispatches AUTH_ERROR
        dispatch(authError(err));
      });
  };
}


// Cognito - Auth.forgotPasswordSubmit()
export function confirmForgotPassword( { username, code, newPassword }, navigate) {
  return function(dispatch) {
    console.log('actions.confirmForgotPassword(): username, code, newPassword: ', { username, code, newPassword });

    // forgotPasswordSubmit (cognito)
    Auth.forgotPasswordSubmit(username, code, newPassword)
      .then( data => {
        console.log('actions.confirmForgotPassword():Auth.forgotPasswordSubmit() data:', data);
        // TODO - User password changed successfully, do we need to login again?
        dispatch({ type: FORGOT_PASSWORD_CONFIRM });

        navigate('/');
      })
      .catch( err => {
        console.error('actions.confirmForgotPassword():Auth.forgotPasswordSubmit() err:', err);

        // error -- invoke authError which dispatches AUTH_ERROR
        dispatch(authError(err));
      });
  };
}
