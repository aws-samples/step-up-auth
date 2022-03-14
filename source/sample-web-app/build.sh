#!/bin/sh

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Clean up on exit
trap trap_signals 0 INT QUIT KILL TERM
trap_signals() {
    rm -rf /tmp/$$*
}

#####################################################################
# PREFLIGHT CHECK
if [ -z "${AWS_REGION}" -o \
     -z "${COGNITO_USER_POOL_ID}" -o \
     -z "${COGNITO_CLIENT_ID}" -o \
     -z "${API_GATEWAY_API_NAME}" -o \
     -z "${API_GATEWAY_API_ENDPOINT}" ]; then
    echo "Missing environment variables.  Ensure following environment variables are set"
    echo "  AWS_REGION"
    echo "  COGNITO_USER_POOL_ID"
    echo "  COGNITO_CLIENT_ID"
    echo "  API_GATEWAY_API_NAME"
    echo "  API_GATEWAY_API_ENDPOINT"
    exit 1
fi

if [ -z "$AWS_CLI_BIN" ]; then
    AWS_CLI_BIN="aws"
fi

#####################################################################
# MORE PREFLIGHT CHECK
# make sure that the working directory is the root project folder
if [ ! -f "package.json" -o \
     ! -d "src" -o \
     ! -d "tests" ]; then
   echo "Error locating required files and folders.  Missing one of the following in the working directory:"
   echo "    package.json"
   echo "    src/"
   echo "    tests/"
   exit 1
fi

#####################################################################
# RUN BUILD SCRIPT

(cd dist && rm -rf *) > /tmp/$$.init-clean.log 2> /tmp/$$.init-clean.log

echo "Installing node modules"
yarn install > /tmp/$$.yarn-install.log 2>&1

echo "Running webpack build"
node_modules/webpack/bin/webpack.js \
  --env \
    NODE_ENV=production \
    AWS_REGION="${AWS_REGION}" \
    USER_POOL_ID="${COGNITO_USER_POOL_ID}" \
    CLIENT_ID="${COGNITO_CLIENT_ID}" \
    API_GATEWAY_API_NAME="${API_GATEWAY_API_NAME}" \
    API_GATEWAY_API_ENDPOINT="${API_GATEWAY_API_ENDPOINT}" \
  --progress > /tmp/$$.webpack.log 2>&1

echo "Done!"
