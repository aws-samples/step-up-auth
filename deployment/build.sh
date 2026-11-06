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

# check required files and folders
if [ ! -d "../source/step-up-authorizer" -o \
     ! -d "../source/step-up-challenge" -o \
     ! -d "../source/step-up-initiate" -o \
     ! -d "../source/sample-api" ]; then
   echo "Error locating required files and folders.  Missing one of the following in the working directory:"
   echo "    ../source/step-up-authorizer"
   echo "    ../source/step-up-challenge"
   echo "    ../source/step-up-initiate"
   echo "    ../source/sample-api"
   exit 2
fi

incremental=1
if [ $# -ne 1 ] || [ "$1" != "incremental" ]; then
  incremental=0
fi

#####################################################################
# FUNCS

# build one lambda/project
build() {
  project_name=$1
  echo
  echo ">> building ${project_name} lambda"
  ( cd ../source/${project_name} && npm ci && npm link @step-up-auth/auth-sdk @step-up-auth/auth-utils && ./build.sh generate-deployable-zip ) || exit 3
}

# build all lambdas
buildAll() {
  # auth-utils
  echo ">> preparing auth-utils"
  ( cd ../source/auth-utils && npm ci && npm link ) > /tmp/$$.auth-utils-prepare.log 2> /tmp/$$.auth-utils-prepare.log || exit 3

  # auth-sdk
  echo ">> preparing auth-sdk"
  ( cd ../source/auth-sdk && npm ci && npm link && npm link @step-up-auth/auth-utils ) > /tmp/$$.auth-sdk-prepare.log 2> /tmp/$$.auth-sdk-prepare.log || exit 3

  # step-up-authorizer
  build step-up-authorizer

  # step-up-challenge
  build step-up-challenge

  # step-up-initiate
  build step-up-initiate

  # sample-api
  build sample-api

  # web-ui
  echo ">> preparing web-ui"
  ( cd ../source/sample-web-app && npm ci ) > /tmp/$$.web-ui.setup.log 2> /tmp/$$.web-ui.setup.log || exit 3
  # software bills of materials of the deployed code
  lambdaSbom step-up-authorizer
  lambdaSbom step-up-challenge
  lambdaSbom step-up-initiate
  lambdaSbom sample-api
  sbom sample-web-app
}
# write a CycloneDX software bill of materials of what one Lambda function ships to
# ../source/<project>/build/sbom/<project>.cdx.json: every package installed in build/dist, the
# content of the deployable zip, including the dependencies of the bundled auth-utils and auth-sdk
# libraries.  build/dist/package.json still lists devDependencies that are not installed there, so
# npm sbom reads a copy of build/dist without them.
lambdaSbom() {
  project_name=$1
  sbom_tree=/tmp/$$.sbom/${project_name}
  echo ">> writing ${project_name} SBOM"
  ( mkdir -p /tmp/$$.sbom ../source/${project_name}/build/sbom && \
    cp -R ../source/${project_name}/build/dist "${sbom_tree}" && \
    ( cd "${sbom_tree}" && npm pkg delete devDependencies ) && \
    ( cd "${sbom_tree}" && npm sbom --sbom-format cyclonedx --sbom-type application ) > ../source/${project_name}/build/sbom/${project_name}.cdx.json ) || exit 3
}
# write a CycloneDX software bill of materials of one project's production dependencies (from its
# package-lock.json) to ../source/<project>/build/sbom/<project>.cdx.json
sbom() {
  project_name=$1
  echo ">> writing ${project_name} SBOM"
  ( cd ../source/${project_name} && mkdir -p build/sbom && npm sbom --sbom-format cyclonedx --sbom-type application --omit dev > build/sbom/${project_name}.cdx.json ) || exit 3
}

# build one lambda/project incrementally.  this func performs a very
# basic incremental build check.  It can be enhanced further.
# - check if <project>/build/compressed/*zip file exists.
#   - if zip file exist, skip build
#   - otherwise build the project
buildIncremental() {
  project_name=$1
  (
    if [ ! -d ../source/${project_name}/build/compressed ]; then
      echo
      echo ">> building ${project_name} lambda"
      ( cd ../source/${project_name} && ./build.sh generate-deployable-zip ) || exit 3
    else
      ls ../source/${project_name}/build/compressed/*zip > /dev/null 2> /dev/null
      if [ ! $? -eq 0 ]; then
        echo
        echo ">> building ${project_name} lambda"
        ( cd ../source/${project_name} && ./build.sh generate-deployable-zip ) || exit 3
      else
        echo "build skipped. ${project_name} lambda zip found"
      fi
    fi
  )
}

buildAllIncremental() {
  # step-up-authorizer
  buildIncremental step-up-authorizer

  # step-up-challenge
  buildIncremental step-up-challenge

  # step-up-initiate
  buildIncremental step-up-initiate

  # sample-api
  buildIncremental sample-api
}

#####################################################################
# BUILD

if [ $incremental -eq 0 ]; then
  buildAll;
else
  buildAllIncremental;
fi
