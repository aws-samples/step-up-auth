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

if [ -z "${AWS_REGION}" -o \
     -z "${AWS_ACCOUNT}" -o \
     -z "${NODE_ENV}" -o \
     -z "${ENV_PREFIX}" ]; then
    echo "Missing environment variables.  Ensure following environment variables are set"
    echo "  AWS_REGION"
    echo "  AWS_ACCOUNT"
    echo "  NODE_ENV"
    echo "  ENV_PREFIX"
    exit 1
fi

if [ -z "$AWS_CLI_BIN" ]; then
    AWS_CLI_BIN="aws"
fi

#####################################################################
# MORE PREFLIGHT CHECK

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


#####################################################################
# VARIABLES

outputs_file="/tmp/$$.cdk-infrastructure-outputs.json"


#####################################################################
# DESTROY / UNDEPLOY

# deployment CDK stacks
./node_modules/.bin/cdk \
    destroy \
    --context "env_prefix=${ENV_PREFIX}" \
    --context "node_env=${NODE_ENV}" \
    --context "aws_region=${AWS_REGION}" \
    --context "aws_account=${AWS_ACCOUNT}" \
    --require-approval never \
    --outputs-file "${outputs_file}" \
    --all || exit 3
