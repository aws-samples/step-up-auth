// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { combineReducers } from 'redux';
import ReduxFormReducer from './FormReducer';
import AuthReducer from './AuthReducer';
import StepUpReducer from './StepUpReducer';
import TransferReducer from './TransferReducer';

const rootReducer = combineReducers({
  form: ReduxFormReducer,
  auth: AuthReducer,
  stepUp: StepUpReducer,
  transfer: TransferReducer
});

export default rootReducer;
