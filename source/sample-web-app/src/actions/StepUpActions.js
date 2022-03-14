// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Auth, API } from "aws-amplify";

import {
  STEP_UP_ERROR,
  STEP_UP_INITIATED,
  STEP_UP_COMPLETED,
  STEP_UP_CLEAR } from "./Types";
import config from "../config";

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
    // eslint-disable-next-line no-undef
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

      Auth.currentSession()
        .then((session) => {
          const accessToken = session.getAccessToken().getJwtToken();
          const idToken = session.getIdToken().getJwtToken();
          return {accessToken, idToken};
        })
        .then((tokens) => {
          const { accessToken, idToken } = tokens;
          // API call
          API.post(config.REST_API_ENDPOINTS[0].name, "initiate-auth", {
            headers: {
              Identification: `Bearer ${idToken}`,
              Authorization: `Bearer ${accessToken}`,
            },
            response: true // OPTIONAL (return the entire Axios response object instead of only response.data)
          })
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
          // catch API.post() error
          .catch((err) => {
            console.log("StepUpActions.stepUpInitiate(): error response:", err);
            // const errorMessage = `${err.message}. ${err.response.data}`;
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
        // catch Auth.currentSession() error
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

    Auth.currentSession()
      .then((session) => {
        const accessToken = session.getAccessToken().getJwtToken();
        const idToken = session.getIdToken().getJwtToken();
        return {accessToken, idToken};
      })
      .then((tokens) => {
        const { accessToken, idToken } = tokens;
        // API call
        API.post(config.REST_API_ENDPOINTS[0].name, "respond-to-challenge", {
          headers: {
            Identification: `Bearer ${idToken}`,
            Authorization: `Bearer ${accessToken}`,
          },
          body: {
            'step-up-type': stepUpType,
            'challenge-response': challengeResponse
          },
          response: true // OPTIONAL (return the entire Axios response object instead of only response.data)
        })
        // handle API success
        .then((response) => {
          console.log("StepUpActions.stepUpRespondToChallenge(): response:", response);
          const successMessage = `${response.details}`;
          dispatch({
            type: STEP_UP_COMPLETED,
            payload: {
              details: successMessage,
              code: stepUpType
            },
          });
        })
        // catch API.post() error
        .catch((err) => {
          console.log("StepUpActions.stepUpRespondToChallenge(): error response:", err);
          // const errorMessage = `${err.message}. ${err.response.data}`;
          dispatch({
            type: STEP_UP_ERROR,
            payload: {
              message: err.message,
              origin: STEP_UP_COMPLETED
            }
          });
        });
      })
      // catch Auth.currentSession() error
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
