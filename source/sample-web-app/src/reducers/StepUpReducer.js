// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  STEP_UP_ERROR,
  STEP_UP_INITIATED,
  STEP_UP_REAUTH_USERNAME,
  STEP_UP_REAUTH_MFA_REQUIRED,
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

      // a session-ending failure returns the flow to the password stage so the user can start over
      if (action.payload.resetMfa) {
        returnProps.reauthMfaRequired = false;
        returnProps.reauthMfaType = null;
      }

      console.log("StepUpReducer. action: ", action);
      console.log("StepUpReducer. returning props: ", returnProps);
      return returnProps;
    }
    case STEP_UP_REAUTH_USERNAME: {
      const returnProps = {
        ...state,
        reauthUsername: action.payload.username,
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
        challengeId: action.payload.challengeId,
        reauthMfaRequired: false,
        reauthMfaType: null,
      };

      console.log("StepUpReducer. action: ", action);
      console.log("StepUpReducer. returning props: ", returnProps);
      return returnProps;
    }
    case STEP_UP_REAUTH_MFA_REQUIRED: {
      const returnProps = {
        ...state,
        error: "",
        errorOrigin: "",
        steppedUp: false,
        reauthMfaRequired: true,
        reauthMfaType: action.payload.mfaType,
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
        reauthMfaRequired: false,
        reauthMfaType: null,
        reauthUsername: null,
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
        reauthMfaRequired: false,
        reauthMfaType: null,
        reauthUsername: null,
      };

      console.log("StepUpReducer. action: ", action);
      console.log("StepUpReducer. returning props: ", returnProps);
      return returnProps;
    }
  }

  return state;
}
