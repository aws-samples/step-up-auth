// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { fetchAuthSession } from "aws-amplify/auth";
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

// Step-up - initiate
export function stepUpInitiate(mock) {
  return (dispatch) => {
    console.log("StepUpActions.stepUpInitiate(): mock:", mock || false);
    return new Promise((resolve, reject) => {

      if (mock) {
        dispatch({
          type: STEP_UP_INITIATED,
          payload: {
            code: "SMS_STEP_UP"
          }
        });
        return;
      }

      getSessionTokens()
        .then((tokens) => {
          const { accessToken, idToken } = tokens;
          // API call
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
          // handle API success
          .then((response) => {
            console.log("StepUpActions.stepUpInitiate(): response:", response);
            if (response && response.data &&
                (
                  response.data.code === "SOFTWARE_TOKEN_STEP_UP" ||
                  response.data.code === "SMS_STEP_UP" ||
                  response.data.code === "MAYBE_SOFTWARE_TOKEN_STEP_UP"
                )
              ) {
              dispatch({
                type: STEP_UP_INITIATED,
                payload: {
                  code: response.data.code
                }
              });
              resolve(true); // resolve with dummy value
            } else {
              dispatch({
                type: STEP_UP_ERROR,
                payload: {
                  message: "Invalid step-up initiate response",
                  origin: STEP_UP_INITIATED
                }
              });
              resolve(true); // resolve with dummy value
            }
          })
          // catch post() error
          .catch((err) => {
            console.log("StepUpActions.stepUpInitiate(): error response:", err);
            dispatch({
              type: STEP_UP_ERROR,
              payload: {
                message: err.message,
                origin: STEP_UP_INITIATED
              }
            });
            reject(false); // reject with dummy value
          });
        })
        // catch fetchAuthSession() error
        .catch((err) => {
          console.log("StepUpActions.stepUpInitiate(): error response:", err);
          dispatch({
            type: STEP_UP_ERROR,
            payload: {
              message: err.message,
              origin: STEP_UP_INITIATED
            }
          });
          reject(false); // reject with dummy value
        });
    });
  };
}

// Step-up - respond to challenge
export function stepUpRespondToChallenge(mock, stepUpType, challengeResponse) {
  return function (dispatch) {
    console.log("StepUpActions.stepUpRespondToChallenge()");

    if (mock) {
      dispatch({
        type: STEP_UP_COMPLETED,
        payload: {
          details: STEP_UP_COMPLETED
        }
      });
      return;
    }

    getSessionTokens()
      .then((tokens) => {
        const { accessToken, idToken } = tokens;
        // API call
        post({
          apiName: config.REST_API_ENDPOINTS[0].name,
          path: "/respond-to-challenge",
          options: {
            headers: {
              Identification: `Bearer ${idToken}`,
              Authorization: `Bearer ${accessToken}`,
            },
            body: {
              'step-up-type': stepUpType,
              'challenge-response': challengeResponse
            }
          }
        }).response
        .then(({ body }) => body.json())
        // handle API success
        .then((response) => {
          console.log("StepUpActions.stepUpRespondToChallenge(): response:", response);
          const successMessage = `${response && response.details}`;
          dispatch({
            type: STEP_UP_COMPLETED,
            payload: {
              details: successMessage,
              code: stepUpType
            },
          });
        })
        // catch post() error
        .catch((err) => {
          console.log("StepUpActions.stepUpRespondToChallenge(): error response:", err);
          dispatch({
            type: STEP_UP_ERROR,
            payload: {
              message: err.message,
              origin: STEP_UP_COMPLETED
            }
          });
        });
      })
      // catch fetchAuthSession() error
      .catch((err) => {
        dispatch({
          type: STEP_UP_ERROR,
          payload: {
            message: err.message,
            origin: STEP_UP_COMPLETED
          }
        });
      });

  };
}
