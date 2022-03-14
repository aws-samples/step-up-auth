// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { reducer as formReducer } from 'redux-form';

export default formReducer.plugin({
  // login, forget password, and register form
  // do any login form field handling here if needed
  loginForm: (state, action) => {
    //console.log('redux_form_reducer.loginForm: state, action', {state, action});
    return state;
  }
  // add any other redux forms here
});
