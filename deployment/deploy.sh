#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

#####################################################################
# TRAP SHELL SIGNALS

# clean-up on exit
trap trap_signals 0 INT QUIT KILL TERM
trap_signals() {
    rm -rf /tmp/$$*
}

#####################################################################
# PREFLIGHT CHECK

# make sure required environment variables are set
if [ -z "${AWS_REGION}" -o \
     -z "${AWS_ACCOUNT}" -o \
     -z "${AWS_PROFILE}" -o \
     -z "${NODE_ENV}" -o \
     -z "${ENV_PREFIX}" ]; then
    echo "Missing environment variables.  Ensure following environment variables are set"
    echo "  AWS_REGION"
    echo "  AWS_ACCOUNT"
    echo "  AWS_PROFILE"
    echo "  NODE_ENV"
    echo "  ENV_PREFIX"
    exit 1
fi

if [ -z "$AWS_CLI_BIN" ]; then
    AWS_CLI_BIN="aws"
fi

# make sure that required files and folders are the root project folder
if [ ! -d "bin" -o \
     ! -d "lib" -o \
     ! -d "test" -o \
     ! -f "package.json" -o \
     ! -f "cdk.json" -o \
     ! -f "jest.config.js" ]; then
   echo "Error locating required files and folders.  Missing one of the following in the working directory:"
   echo "    bin/"
   echo "    lib/"
   echo "    test/"
   echo "    package.json"
   echo "    cdk.json"
   echo "    jest.config.js"
   exit 2
fi

# double check node_modules folder exists
ls ./node_modules/.bin/cdk > /dev/null 2> /dev/null
if [ ! $? -eq 0 ]; then
  echo "Please run 'npm install' before running the deployment"
  exit 3
fi

#####################################################################
# VARIABLES

outputs_file="/tmp/$$.cdk-infrastructure-outputs.json"

#####################################################################
# BUILD

# build all lambdas first
# do an incremental build during deployment.  this speeds up deployment time
./build.sh incremental

#####################################################################
# DEPLOYMENT

# log some info
echo
echo "Initiating CDK deployment.."

# bootstrap CDK
./node_modules/.bin/cdk bootstrap aws://${AWS_ACCOUNT}/${AWS_REGION} || exit 4

# deployment CDK stacks
./node_modules/.bin/cdk \
    deploy \
    --context "env_prefix=${ENV_PREFIX}" \
    --context "node_env=${NODE_ENV}" \
    --context "aws_region=${AWS_REGION}" \
    --context "aws_account=${AWS_ACCOUNT}" \
    --require-approval never \
    --outputs-file "${outputs_file}" \
    --all || exit 5

# prepare web-ui deployment
export COGNITO_USER_POOL_ID="$(awk '/UserPoolId/{ gsub(/"|,/, ""); print $2 }' "$outputs_file")"
export COGNITO_CLIENT_ID="$(awk '/UserPoolClientId/{ gsub(/"|,/, ""); print $2 }' "$outputs_file")"
export API_GATEWAY_API_NAME="$(awk '/RestApiName/{ gsub(/"|,/, ""); print $2 }' "$outputs_file")"
export API_GATEWAY_API_ENDPOINT="$(awk '/StageUrl/{ gsub(/"|,/, ""); print $2 }' "$outputs_file")"
export S3_BUCKET_NAME="$(awk '/WebUiBucketName/{ gsub(/"|,/, ""); print $2 }' "$outputs_file")"
export CLOUDFRONT_DISTRIBUTION_ID="$(awk '/CloudfrontDistributionId/{ gsub(/"|,/, ""); print $2 }' "$outputs_file")"
export CLOUDFRONT_DISTRIBUTION_DOMAIN="$(awk '/CloudfrontDistributionDomainName/{ gsub(/"|,/, ""); print $2 }' "$outputs_file")"


# deploy web-ui
echo
echo "Deploying Sample Web App.."
(cd ../source/sample-web-app && ./build.sh && ./deploy.sh ) || exit 6

# log more info
echo
echo "Sample Web App URL: ${CLOUDFRONT_DISTRIBUTION_DOMAIN}"
