#!/bin/sh

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Clean up on exit
trap trap_signals 0 INT QUIT KILL TERM
trap_signals() {
    rm -rf /tmp/$$*
}

# Install yarn
# We will use yarn to build the web application

which yarn > /tmp/$$.yarn-bin-install-1.log 2> /tmp/$$.yarn-bin-install-1.log
if [ $? -ne 0 ]; then
  echo "Installing yarn"
  npm install --global yarn > /tmp/$$.yarn-bin-install-2.log 2> /tmp/$$.yarn-bin-install-2.log
  echo "yarn installed in: `which yarn`"
fi
