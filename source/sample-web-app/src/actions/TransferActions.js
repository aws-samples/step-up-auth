// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Auth, API } from "aws-amplify";

import {
  TRANSFER_SUCCESS,
  TRANSFER_ERROR,
  TRANSFER_CLEAR,
  INFO_SUCCESS,
  INFO_ERROR,
  INFO_CLEAR } from "./Types";
import config from "../config";
import {stepUpInitiate} from "./StepUpActions";
// import store from '../store';

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

    Auth.currentSession()
    .then((session) => {
      const accessToken = session.getAccessToken().getJwtToken();
      const idToken = session.getIdToken().getJwtToken();
      return {accessToken, idToken};
    })
    .then((tokens) => {
      const { accessToken } = tokens;

      const apiName = config.REST_API_ENDPOINTS[0].name;
      const path = 'transfer';
      const myInit = {
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        responseType: 'text', // options are: 'arraybuffer', 'document', 'json', 'text', 'stream'
        response: true // OPTIONAL (return the entire Axios response object instead of only response.data)
      };
      // API call
      API.post(apiName, path, myInit)
      // handle API success
      .then((response) => {
        console.log('TransferActions.transfer(): response received', response);
        dispatch({
          type: TRANSFER_SUCCESS,
          payload: {
            data: response.data
          }
        });

      })
      // catch API.post() error
      .catch((err) => {
        console.log('TransferActions.transfer() code:', err.response.status);

        if (err.response.status == 401) {
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
                  code: err.response.status
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
          const errorMessage = `${err.message}. ${err.response.data.code}`;
          console.log('TransferActions.transfer() error:', errorMessage);
          dispatch({
            type: TRANSFER_ERROR,
            payload: {
              message: errorMessage,
              code: err.response.status
            }
          });
        }


      });
    })
    // catch Auth.currentSession() error
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

    Auth.currentSession()
    .then((session) => {
      const accessToken = session.getAccessToken().getJwtToken();
      const idToken = session.getIdToken().getJwtToken();
      return {accessToken, idToken};
    })
    .then((tokens) => {
      const { accessToken } = tokens;

      const apiName = config.REST_API_ENDPOINTS[0].name;
      const path = 'info';
      const myInit = {
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        responseType: 'json', // options are: 'arraybuffer', 'document', 'json', 'text', 'stream'
        response: true // OPTIONAL (return the entire Axios response object instead of only response.data)
      };
      // API call
      API.get(apiName, path, myInit)
      // handle API success
      .then((response) => {
        console.log('TransferActions.info(): response received', response);

        dispatch({
          type: INFO_SUCCESS,
          payload: {
            data: response.data
          }
        });

      })
      // catch API.post() error
      .catch((err) => {
        const errorMessage = `${err.message}. ${err.response.data.code}`;
        dispatch({
          type: INFO_ERROR,
          payload: {
            message: errorMessage,
            code: err.response.status
          }
        });
      });
    })
    // catch Auth.currentSession() error
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
