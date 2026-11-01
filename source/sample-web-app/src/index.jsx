// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from "react-router-dom";
import { Provider } from 'react-redux';
import { Amplify } from 'aws-amplify';
import store from './store';
import App from './components/App';
import AppHeader from './components/header/AppHeader';
import config from './config';

/* eslint-disable no-undef */
if (process.env.NODE_ENV !== "development") {
  console.log = () => {};
}
console.log('NODE_ENV ? ', process.env.NODE_ENV);
console.log('configuration: ');
console.log('  AWS_REGION: ', config.AWS_REGION);
console.log('  AWS_COGNITO_IDENTITY_POOL_ID: ', config.AWS_COGNITO_IDENTITY_POOL_ID);
console.log('  AWS_COGNITO_USER_POOL_ID: ', config.AWS_COGNITO_USER_POOL_ID);
console.log('  AWS_COGNITO_CLIENT_ID: ', config.AWS_COGNITO_CLIENT_ID);
console.log('  APPSYNC_API_ENDPOINT.graphql_endpoint: ', config.APPSYNC_API_ENDPOINT.graphql_endpoint);
console.log('  APPSYNC_API_ENDPOINT.mock: ', config.APPSYNC_API_ENDPOINT.mock);
console.log('  REST_API_ENDPOINTS: ', config.REST_API_ENDPOINTS);

/* eslint-enable no-undef */


// AWS Amplify (v6) Configuration
// https://docs.amplify.aws/gen1/javascript/tools/libraries/configure-categories/
// The Cognito region is derived from the user pool id. The REST API URL is
// endpoint + path, so a trailing slash on the endpoint is removed.
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: config.AWS_COGNITO_USER_POOL_ID, // Amazon Cognito User Pool ID
      userPoolClientId: config.AWS_COGNITO_CLIENT_ID, // Amazon Cognito Web Client ID
      // OPTIONAL - Amazon Cognito Identity Pool ID (only when set)
      ...(config.AWS_COGNITO_IDENTITY_POOL_ID ? { identityPoolId: config.AWS_COGNITO_IDENTITY_POOL_ID } : {})
    }
  },
  API: {
    REST: {
      [config.REST_API_ENDPOINTS[0].name]: {
        endpoint: config.REST_API_ENDPOINTS[0].endpoint.replace(/\/+$/, ''),
        region: config.AWS_REGION
      }
    }
  }
});


const root = ReactDOM.createRoot(document.querySelector('.app-container') || document.createElement('div'));
root.render(<Provider store={store}>
  <BrowserRouter>
    <AppHeader/>
    <App />
  </BrowserRouter>
</Provider>);
