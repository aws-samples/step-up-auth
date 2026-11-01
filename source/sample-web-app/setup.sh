#!/bin/sh

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Clean up on exit
trap trap_signals 0 INT QUIT KILL TERM
trap_signals() {
    rm -rf /tmp/$$*
}

# Install the node modules locked in package-lock.json
# We use npm to build the web application

echo "Installing node modules"
npm ci > /tmp/$$.npm-ci.log 2>&1
if [ $? -ne 0 ]; then
  echo "Error during npm ci.  npm log:"
  cat /tmp/$$.npm-ci.log
  exit 2
fi

