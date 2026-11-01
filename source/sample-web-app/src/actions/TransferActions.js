// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { get, post } from "aws-amplify/api";

import {
  TRANSFER_SUCCESS,
  TRANSFER_ERROR,
  TRANSFER_CLEAR,
  INFO_SUCCESS,
  INFO_ERROR,
  INFO_CLEAR } from "./Types";
import config from "../config";
import { getSessionTokens, stepUpInitiate } from "./StepUpActions";
// import store from '../store';

// Amplify v6 REST errors carry the HTTP response as
// err.response = { statusCode, headers, body } with body as a string.
function errorStatusCode(err) {
  return err && err.response ? err.response.statusCode : undefined;
}

function errorBody(err) {
  try {
    return JSON.parse((err && err.response && err.response.body) || '{}') || {};
  } catch (e) {
    return {};
  }
}

// Clean store - transfer results
export function clearTransfer() {
  return function(dispatch) {
    console.log('TransferActions.clearsTransfer() called');
    dispatch({ type: TRANSFER_CLEAR });
  };
}

// Sample Privileged API protected by step-up authorizer
// transfer
export function transfer(mock) {
  return function (dispatch, getState) {
    if (mock) {
      dispatch({
        type: TRANSFER_SUCCESS,
        payload: {
          message: "mock transfer completed"
        }
      });
      return;
    }

    getSessionTokens()
    .then((tokens) => {
      const { accessToken } = tokens;

      const apiName = config.REST_API_ENDPOINTS[0].name;
      const path = '/transfer';
      const options = {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      };
      // API call
      post({ apiName, path, options }).response
      // the response body is read as text (Amplify v4 responseType: 'text')
      .then(({ body }) => body.text())
      // handle API success
      .then((data) => {
        console.log('TransferActions.transfer(): response received', data);
        dispatch({
          type: TRANSFER_SUCCESS,
          payload: {
            data: data
          }
        });

      })
      // catch post() error
      .catch((err) => {
        const statusCode = errorStatusCode(err);
        console.log('TransferActions.transfer() code:', statusCode);

        if (statusCode == 401) {
          dispatch(stepUpInitiate())
            .then(data => {
              console.log('TransferActions.transfer(): stepUpInitiate() success:', data);
              console.log('TransferActions.transfer(): stepUpInitiate() stepUp state:', getState().stepUp);
              const errorMessage = `${err.message}. ${getState().stepUp.stepUpType}`;
              console.log('TransferActions.transfer() error:', errorMessage);
              dispatch({
                type: TRANSFER_ERROR,
                payload: {
                  message: errorMessage,
                  code: statusCode
                }
              });
            })
            .catch(err2 => {
              console.log('TransferActions.transfer(): stepUpInitiate() error:', err2);
              console.log('TransferActions.transfer(): stepUpInitiate() stepUp state:', getState().stepUp);
              // if (getState().stepUp.error && getState().stepUp.errorOrigin === STEP_UP_INITIATED) {
              dispatch({
                type: TRANSFER_ERROR,
                payload: {
                  message: getState().stepUp.error,
                  code: 429
                }
              });
            });
        } else {
          const errorMessage = `${err.message}. ${errorBody(err).code}`;
          console.log('TransferActions.transfer() error:', errorMessage);
          dispatch({
            type: TRANSFER_ERROR,
            payload: {
              message: errorMessage,
              code: statusCode
            }
          });
        }


      });
    })
    // catch fetchAuthSession() error
    .catch((err) => {
      dispatch({
        type: TRANSFER_ERROR,
        payload: {
          message: err.message
        }
      });
    });
  };
}

// Clean store - info results
export function clearInfo() {
  return function(dispatch) {
    console.log('TransferActions.clearInfo() called');
    dispatch({ type: INFO_CLEAR });
  };
}

// info
export function info(mock) {
  return function (dispatch) {
    if (mock) {
      dispatch({
        type: INFO_SUCCESS,
        payload: {
          message: "mock info"
        }
      });
      return;
    }

    getSessionTokens()
    .then((tokens) => {
      const { accessToken } = tokens;

      const apiName = config.REST_API_ENDPOINTS[0].name;
      const path = '/info';
      const options = {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      };
      // API call
      get({ apiName, path, options }).response
      // the response body is parsed as JSON (Amplify v4 responseType: 'json')
      .then(({ body }) => body.json())
      // handle API success
      .then((data) => {
        console.log('TransferActions.info(): response received', data);

        dispatch({
          type: INFO_SUCCESS,
          payload: {
            data: data
          }
        });

      })
      // catch get() error
      .catch((err) => {
        const errorMessage = `${err.message}. ${errorBody(err).code}`;
        dispatch({
          type: INFO_ERROR,
          payload: {
            message: errorMessage,
            code: errorStatusCode(err)
          }
        });
      });
    })
    // catch fetchAuthSession() error
    .catch((err) => {
      dispatch({
        type: INFO_ERROR,
        payload: {
          message: err.message
        }
      });
    });
  };
}
