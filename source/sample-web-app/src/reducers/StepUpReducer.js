// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  STEP_UP_ERROR,
  STEP_UP_INITIATED,
  STEP_UP_COMPLETED,
  STEP_UP_CLEAR } from "../actions/Types";

export default function (state = {}, action) {
  switch (action.type) {
    case STEP_UP_ERROR: {
      const returnProps = {
        ...state,
        error: action.payload.message,
        errorOrigin: action.payload.origin,
        steppedUp: false,
      };

      console.log("StepUpReducer. action: ", action);
      console.log("StepUpReducer. returning props: ", returnProps);
      return returnProps;
    }
    case STEP_UP_INITIATED: {
      const returnProps = {
        ...state,
        error: "",
        errorOrigin: "",
        steppedUp: false,
        stepUpType: action.payload.code,
      };

      console.log("StepUpReducer. action: ", action);
      console.log("StepUpReducer. returning props: ", returnProps);
      return returnProps;
    }
    case STEP_UP_COMPLETED: {
      const returnProps = {
        ...state,
        error: "",
        errorOrigin: "",
        steppedUp: true,
        stepUpType: action.payload.code,
      };

      console.log("StepUpReducer. action: ", action);
      console.log("StepUpReducer. returning props: ", returnProps);
      return returnProps;
    }
    case STEP_UP_CLEAR: {
      const returnProps = {
        ...state,
        error: "",
        errorOrigin: "",
        steppedUp: false,
        stepUpType: null,
      };

      console.log("StepUpReducer. action: ", action);
      console.log("StepUpReducer. returning props: ", returnProps);
      return returnProps;
    }
  }

  return state;
}
