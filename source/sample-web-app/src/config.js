// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/* eslint-disable no-undef */
const config = {
  AWS_REGION: __AWS_REGION__,
  AWS_COGNITO_IDENTITY_POOL_ID: __COGNITO_IDENTITY_POOL_ID__, // leave blank if not set
  AWS_COGNITO_USER_POOL_ID: __COGNITO_USER_POOL_ID__,
  AWS_COGNITO_CLIENT_ID: __COGNITO_CLIENT_ID__,
  APPSYNC_API_ENDPOINT: {
    graphql_endpoint: __APPSYNC_API__,
    mock: __MOCK_ENABLED__
  },
  REST_API_ENDPOINTS: [
    {
      name: __API_GATEWAY_API_NAME__,
      endpoint: __API_GATEWAY_API_ENDPOINT__
    }
  ]
  // any additional config goes here
};

export default config;
