// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { fetchAuthSession, signIn, signOut, confirmSignIn } from "aws-amplify/auth";
import { post } from "aws-amplify/api";

import {
  STEP_UP_ERROR,
  STEP_UP_INITIATED,
  STEP_UP_REAUTH_MFA_REQUIRED,
  STEP_UP_COMPLETED,
  STEP_UP_CLEAR } from "./Types";
import config from "../config";

// Current access and id tokens as JWT strings (fetchAuthSession() refreshes
// expired tokens). Rejects when there is no signed-in user, like the Amplify v4
// currentSession() did.
export function getSessionTokens() {
  return fetchAuthSession()
    .then((session) => {
      const tokens = session && session.tokens;
      if (!tokens || !tokens.accessToken || !tokens.idToken) {
        throw new Error("No current user");
      }
      return {
        accessToken: tokens.accessToken.toString(),
        idToken: tokens.idToken.toString()
      };
    });
}

// Clean store
export function clearstepUp() {
  return function(dispatch) {
    console.log('StepUpActions.clearstepUp() called');
    dispatch({ type: STEP_UP_CLEAR });
  };
}

// Step-up - initiate.  The backend now answers with REAUTH_REQUIRED: step-up is satisfied by a fresh
// re-authentication (password + the user's existing MFA), not by verifying or enrolling an MFA factor.
export function stepUpInitiate(mock) {
  return (dispatch) => {
    console.log("StepUpActions.stepUpInitiate(): mock:", mock || false);
    return new Promise((resolve, reject) => {

      if (mock) {
        dispatch({ type: STEP_UP_INITIATED, payload: { code: "REAUTH_REQUIRED", challengeId: "mock-challenge" } });
        resolve(true);
        return;
      }

      getSessionTokens()
        .then((tokens) => {
          const { accessToken, idToken } = tokens;
          post({
            apiName: config.REST_API_ENDPOINTS[0].name,
            path: "/initiate-auth",
            options: {
              headers: {
                Identification: `Bearer ${idToken}`,
                Authorization: `Bearer ${accessToken}`,
              }
            }
          }).response
          .then(({ statusCode, body }) => body.json().then((data) => ({ statusCode, data })))
          .then((response) => {
            console.log("StepUpActions.stepUpInitiate(): response:", response);
            if (response && response.data && response.data.code === "REAUTH_REQUIRED") {
              dispatch({
                type: STEP_UP_INITIATED,
                payload: { code: response.data.code, challengeId: response.data.challengeId }
              });
              resolve(true);
            } else {
              dispatch({
                type: STEP_UP_ERROR,
                payload: { message: "Invalid step-up initiate response", origin: STEP_UP_INITIATED }
              });
              resolve(true);
            }
          })
          .catch((err) => {
            console.log("StepUpActions.stepUpInitiate(): error response:", err);
            dispatch({ type: STEP_UP_ERROR, payload: { message: err.message, origin: STEP_UP_INITIATED } });
            reject(false);
          });
        })
        .catch((err) => {
          console.log("StepUpActions.stepUpInitiate(): error response:", err);
          dispatch({ type: STEP_UP_ERROR, payload: { message: err.message, origin: STEP_UP_INITIATED } });
          reject(false);
        });
    });
  };
}

// Complete step-up once a fresh Cognito session exists: fetch the fresh tokens and present them,
// together with the one-time challengeId minted by /initiate-auth, to /respond-to-challenge.  The
// backend binds completion to that challenge and to the fresh token's auth_time.
function completeStepUp(dispatch, getState) {
  // the one-time challenge id minted by /initiate-auth; the backend binds completion to it
  const challengeId = getState().stepUp && getState().stepUp.challengeId;

  return getSessionTokens()
    .then((tokens) => {
      const { accessToken, idToken } = tokens;
      return post({
        apiName: config.REST_API_ENDPOINTS[0].name,
        path: "/respond-to-challenge",
        options: {
          headers: {
            Identification: `Bearer ${idToken}`,
            Authorization: `Bearer ${accessToken}`,
          },
          body: { challengeId }
        }
      }).response;
    })
    .then(({ body }) => body.json())
    .then((response) => {
      console.log("StepUpActions.completeStepUp(): response:", response);
      dispatch({
        type: STEP_UP_COMPLETED,
        payload: { details: `${response && response.details}`, code: "REAUTH_REQUIRED" },
      });
    });
}

// Drive the Amplify sign-in to the point where an MFA code is needed, then hand control back to the
// UI.  SMS codes are only delivered once Cognito creates the challenge (after signIn, or after the
// MFA type is selected), so we must NOT confirm here with a code captured before that challenge
// existed; we render the code input and confirm on the next submit.  When no MFA challenge is raised
// we complete step-up directly.
function advanceReauthStep(output, dispatch, getState) {
  const step = output && output.nextStep && output.nextStep.signInStep;
  console.log("StepUpActions.advanceReauthStep(): signInStep:", step);

  if (step === "DONE") {
    return completeStepUp(dispatch, getState);
  }
  if (step === "CONFIRM_SIGN_IN_WITH_TOTP_CODE") {
    dispatch({ type: STEP_UP_REAUTH_MFA_REQUIRED, payload: { mfaType: "SOFTWARE_TOKEN_MFA" } });
    return Promise.resolve(true);
  }
  if (step === "CONFIRM_SIGN_IN_WITH_SMS_CODE") {
    dispatch({ type: STEP_UP_REAUTH_MFA_REQUIRED, payload: { mfaType: "SMS_MFA" } });
    return Promise.resolve(true);
  }
  if (step === "CONTINUE_SIGN_IN_WITH_MFA_SELECTION") {
    // selecting SMS triggers the code delivery; recurse so the SMS/TOTP code challenge renders its input
    const allowed = (output.nextStep && output.nextStep.allowedMFATypes) || [];
    const choice = allowed.includes("TOTP") ? "TOTP" : "SMS";
    return confirmSignIn({ challengeResponse: choice })
      .then((next) => advanceReauthStep(next, dispatch, getState));
  }
  throw new Error(`Unsupported re-authentication step: ${step}`);
}

// Step-up - re-authentication stage 1: the user re-enters their password.  Amplify v6 rejects a
// sign-in while a session exists, so we sign out locally first; the new session's tokens then carry a
// fresh auth_time.  signIn drives Cognito to the MFA challenge (and sends the SMS code when SMS is the
// factor) without completing it; stepUpReauthConfirm supplies the code the user then receives.
export function stepUpReauthStart(mock, password) {
  return function (dispatch, getState) {
    console.log("StepUpActions.stepUpReauthStart(): re-authenticating");

    if (mock) {
      dispatch({ type: STEP_UP_REAUTH_MFA_REQUIRED, payload: { mfaType: "SOFTWARE_TOKEN_MFA" } });
      return Promise.resolve(true);
    }

    // read the current username before signing out, so we re-authenticate as the same user
    return fetchAuthSession()
      .then((session) => {
        const tokens = session && session.tokens;
        const username = (tokens && tokens.accessToken && tokens.accessToken.payload && tokens.accessToken.payload.username)
          || (tokens && tokens.idToken && tokens.idToken.payload && tokens.idToken.payload["cognito:username"]);
        if (!username) {
          throw new Error("No current user");
        }
        return signOut().then(() => signIn({ username, password }));
      })
      .then((output) => advanceReauthStep(output, dispatch, getState))
      .catch((err) => {
        console.log("StepUpActions.stepUpReauthStart(): error response:", err);
        dispatch({ type: STEP_UP_ERROR, payload: { message: err.message, origin: STEP_UP_COMPLETED } });
      });
  };
}

// Step-up - re-authentication stage 2: the user enters the MFA code Cognito just issued.  We confirm
// the pending Amplify sign-in flow (no new signOut/signIn, so the challenge the code belongs to is
// still open), require it to complete, then present the fresh tokens to /respond-to-challenge.
export function stepUpReauthConfirm(mock, mfaCode) {
  return function (dispatch, getState) {
    console.log("StepUpActions.stepUpReauthConfirm(): confirming MFA code");

    if (mock) {
      dispatch({ type: STEP_UP_COMPLETED, payload: { details: STEP_UP_COMPLETED } });
      return Promise.resolve(true);
    }

    return confirmSignIn({ challengeResponse: mfaCode })
      .then((output) => {
        const step = output && output.nextStep && output.nextStep.signInStep;
        console.log("StepUpActions.stepUpReauthConfirm(): signInStep:", step);
        if (step !== "DONE") {
          throw new Error(`Re-authentication incomplete: ${step}`);
        }
        return completeStepUp(dispatch, getState);
      })
      .catch((err) => {
        console.log("StepUpActions.stepUpReauthConfirm(): error response:", err);
        dispatch({ type: STEP_UP_ERROR, payload: { message: err.message, origin: STEP_UP_COMPLETED } });
      });
  };
}
