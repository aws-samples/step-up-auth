// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { fetchAuthSession, signIn, signOut, confirmSignIn } from "aws-amplify/auth";
import { post } from "aws-amplify/api";

import {
  STEP_UP_ERROR,
  STEP_UP_INITIATED,
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
        dispatch({ type: STEP_UP_INITIATED, payload: { code: "REAUTH_REQUIRED" } });
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
              dispatch({ type: STEP_UP_INITIATED, payload: { code: response.data.code } });
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

// Re-authenticate with Cognito (SRP password + the user's existing MFA), then present the freshly
// issued tokens to /respond-to-challenge to complete step-up.  Amplify v6 does not let you sign in while
// a session exists, so we sign out locally first; the new session's tokens then carry a fresh auth_time.
function reauthenticate(username, password, mfaCode) {
  return signOut()
    .then(() => signIn({ username, password }))
    .then((output) => {
      const step = output && output.nextStep && output.nextStep.signInStep;
      console.log("StepUpActions.reauthenticate(): signInStep:", step);
      if (step === "DONE") {
        return output;
      }
      if (step === "CONFIRM_SIGN_IN_WITH_TOTP_CODE" || step === "CONFIRM_SIGN_IN_WITH_SMS_CODE") {
        return confirmSignIn({ challengeResponse: mfaCode });
      }
      if (step === "CONTINUE_SIGN_IN_WITH_MFA_SELECTION") {
        const allowed = (output.nextStep && output.nextStep.allowedMFATypes) || [];
        const choice = allowed.includes("TOTP") ? "TOTP" : "SMS";
        return confirmSignIn({ challengeResponse: choice })
          .then(() => confirmSignIn({ challengeResponse: mfaCode }));
      }
      throw new Error(`Unsupported re-authentication step: ${step}`);
    });
}

// Step-up - respond to challenge by re-authenticating and presenting the fresh tokens
export function stepUpRespondToChallenge(mock, password, mfaCode) {
  return function (dispatch) {
    console.log("StepUpActions.stepUpRespondToChallenge(): re-authenticating");

    if (mock) {
      dispatch({ type: STEP_UP_COMPLETED, payload: { details: STEP_UP_COMPLETED } });
      return;
    }

    // read the current username before signing out, so we can re-authenticate as the same user
    fetchAuthSession()
      .then((session) => {
        const tokens = session && session.tokens;
        const username = (tokens && tokens.accessToken && tokens.accessToken.payload && tokens.accessToken.payload.username)
          || (tokens && tokens.idToken && tokens.idToken.payload && tokens.idToken.payload["cognito:username"]);
        if (!username) {
          throw new Error("No current user");
        }
        return reauthenticate(username, password, mfaCode);
      })
      .then(() => getSessionTokens())
      .then((tokens) => {
        const { accessToken, idToken } = tokens;
        return post({
          apiName: config.REST_API_ENDPOINTS[0].name,
          path: "/respond-to-challenge",
          options: {
            headers: {
              Identification: `Bearer ${idToken}`,
              Authorization: `Bearer ${accessToken}`,
            }
          }
        }).response;
      })
      .then(({ body }) => body.json())
      .then((response) => {
        console.log("StepUpActions.stepUpRespondToChallenge(): response:", response);
        dispatch({
          type: STEP_UP_COMPLETED,
          payload: { details: `${response && response.details}`, code: "REAUTH_REQUIRED" },
        });
      })
      .catch((err) => {
        console.log("StepUpActions.stepUpRespondToChallenge(): error response:", err);
        dispatch({ type: STEP_UP_ERROR, payload: { message: err.message, origin: STEP_UP_COMPLETED } });
      });
  };
}
