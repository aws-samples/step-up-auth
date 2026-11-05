// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { fetchAuthSession, signIn, signOut, confirmSignIn } from "aws-amplify/auth";
import { post } from "aws-amplify/api";

import {
  STEP_UP_ERROR,
  STEP_UP_INITIATED,
  STEP_UP_REAUTH_USERNAME,
  STEP_UP_REAUTH_MFA_REQUIRED,
  STEP_UP_COMPLETED,
  STEP_UP_CLEAR } from "./Types";
import config from "../config";

// The backend reports an unusable one-time challenge (missing, expired, or not found) with this reason
// on a 401 response; the client must re-initiate rather than retry the same challenge.
const NO_CHALLENGE = "NO_CHALLENGE";

// Read the step-up failure reason the challenge API returns in the body of a non-2xx response.
// Amplify v6 REST errors carry the HTTP response as err.response = { statusCode, headers, body }.
function stepUpFailureReason(err) {
  try {
    const body = err && err.response && err.response.body;
    const parsed = body ? JSON.parse(body) : {};
    return parsed && parsed.reason;
  } catch (e) {
    return undefined;
  }
}

// Dispatch a re-authentication failure. A wrong MFA code (CodeMismatchException) keeps the code stage
// so the user can retry the same open challenge; any other failure (a session-ending error, an expired
// challenge, a bad password) returns the flow to the password stage so the user can start over.
function dispatchReauthError(dispatch, err) {
  const keepCodeStage = !!(err && err.name === "CodeMismatchException");
  const message = stepUpFailureReason(err) === NO_CHALLENGE
    ? "Your step-up challenge is no longer valid. Please invoke the API again."
    : ((err && err.message) || "Re-authentication failed.");
  console.log("StepUpActions.dispatchReauthError(): error response:", err);
  dispatch({
    type: STEP_UP_ERROR,
    payload: { message, origin: STEP_UP_COMPLETED, resetMfa: !keepCodeStage }
  });
}

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

// Drive the Amplify sign-in to the point where the authenticator code is needed, then hand control
// back to the UI.  The password is checked first; only after Cognito accepts it and raises the
// authenticator challenge does the UI ask for the code, and the next submit confirms it.  When no MFA
// challenge is raised we complete step-up directly.
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
  throw new Error(`Unsupported re-authentication step: ${step}`);
}

// Step-up - re-authentication stage 1: the user re-enters their password.  Amplify v6 rejects a
// sign-in while a session exists, so we sign out locally first; the new session's tokens then carry a
// fresh auth_time.  signIn drives Cognito to the authenticator challenge without completing it;
// stepUpReauthConfirm (stage 2) supplies the code from the user's authenticator app.
export function stepUpReauthStart(mock, password) {
  return function (dispatch, getState) {
    console.log("StepUpActions.stepUpReauthStart(): re-authenticating");

    if (mock) {
      dispatch({ type: STEP_UP_REAUTH_MFA_REQUIRED, payload: { mfaType: "SOFTWARE_TOKEN_MFA" } });
      return Promise.resolve(true);
    }

    // Resolve the username without depending on the current session: signing out (which this flow does
    // before signIn) empties the session, so a retry after a wrong password would otherwise find no
    // user. Read it from the session on the first attempt and remember it (username only, never the
    // password) so retries re-authenticate the same user.
    return fetchAuthSession()
      .then((session) => {
        const tokens = session && session.tokens;
        const fromSession = (tokens && tokens.accessToken && tokens.accessToken.payload && tokens.accessToken.payload.username)
          || (tokens && tokens.idToken && tokens.idToken.payload && tokens.idToken.payload["cognito:username"]);
        const remembered = getState().stepUp && getState().stepUp.reauthUsername;
        const username = fromSession || remembered;
        if (!username) {
          throw new Error("No current user");
        }
        if (username !== remembered) {
          dispatch({ type: STEP_UP_REAUTH_USERNAME, payload: { username } });
        }
        return signOut().then(() => signIn({ username, password }));
      })
      .then((output) => advanceReauthStep(output, dispatch, getState))
      .catch((err) => dispatchReauthError(dispatch, err));
  };
}

// Step-up - re-authentication stage 2: the user enters the current authenticator code.  We confirm
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
      .catch((err) => dispatchReauthError(dispatch, err));
  };
}
