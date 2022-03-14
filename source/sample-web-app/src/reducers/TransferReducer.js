// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  TRANSFER_ERROR,
  TRANSFER_SUCCESS,
  TRANSFER_CLEAR,
  INFO_ERROR,
  INFO_SUCCESS,
  INFO_CLEAR } from "../actions/Types";

export default function (state = {}, action) {
  switch (action.type) {
    case TRANSFER_ERROR: {
      const returnProps = {
        ...state,
        transferError: action.payload.message,
        transferCode: action.payload.code
      };

      console.log("TransferReducer. action: ", action);
      console.log("TransferReducer. returning props: ", returnProps);
      return returnProps;
    }
    case TRANSFER_SUCCESS: {
      const returnProps = {
        ...state,
        transferError: "",
        transferCode: 200,
        transferData: action.payload.data
      };

      console.log("TransferReducer. action: ", action);
      console.log("TransferReducer. returning props: ", returnProps);
      return returnProps;
    }
    case TRANSFER_CLEAR: {
      const returnProps = {
        ...state,
        transferError: "",
        transferCode: 0,
        transferData: null
      };

      console.log("TransferReducer. action: ", action);
      console.log("TransferReducer. returning props: ", returnProps);
      return returnProps;
    }
    case INFO_ERROR: {
      const returnProps = {
        ...state,
        infoError: action.payload.message,
        infoCode: action.payload.code
      };

      console.log("TransferReducer. action: ", action);
      console.log("TransferReducer. returning props: ", returnProps);
      return returnProps;
    }
    case INFO_SUCCESS: {
      const returnProps = {
        ...state,
        infoError: "",
        infoCode: 200,
        infoData: action.payload.data
      };

      console.log("TransferReducer. action: ", action);
      console.log("TransferReducer. returning props: ", returnProps);
      return returnProps;
    }
    case INFO_CLEAR: {
      const returnProps = {
        ...state,
        infoError: "",
        infoCode: 0,
        infoData: null
      };

      console.log("TransferReducer. action: ", action);
      console.log("TransferReducer. returning props: ", returnProps);
      return returnProps;
    }
  }

  return state;
}
