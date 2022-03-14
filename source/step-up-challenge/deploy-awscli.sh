#!/bin/sh

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

## initialize and do some pre-flight checks
if [ -z "$AWS_PROFILE" -o -z "$AWS_REGION" -o -z "$AWS_LAMBDA_ROLE_ARN" -o -z "$ENV_PREFIX" ]; then
    echo "Missing environment variables.  Ensure following environment variables are set"
    echo "  AWS_PROFILE"
    echo "  AWS_REGION"
    echo "  AWS_LAMBDA_ROLE_ARN"
    echo "  ENV_PREFIX"
    exit 1
fi

## Change variables as necessary
module_name="step-up-auth-challenge-lambda"

## DO NOT MODIFY
NODE_ENV="${DEPLOYMENT_ENV}"
if [ -z "${NODE_ENV}" ]; then
  NODE_ENV="production"
fi
module_build="build"
module_dist="${module_build}/dist"
module_zip="${module_build}/compressed"
module_export="src/index.handler"

WORKING_DIR="`pwd`"

# show some stats
echo "AWS_PROFILE: ${AWS_PROFILE}"
echo "AWS_REGION: ${AWS_REGION}"
echo "AWS_LAMBDA_ROLE_ARN: ${AWS_LAMBDA_ROLE_ARN}"
echo "ENV_PREFIX: ${ENV_PREFIX}"
echo "WORKING_DIR: ${WORKING_DIR}"
echo "NODE_ENV: ${NODE_ENV}"
echo

## creating distribution zip
echo "creating distribution zip"

# check for dist folder
if [ ! -d "${module_dist}" ]; then
  echo "dist directory is empty. forgot to run build.sh?"
  exit 1
fi

# compress dist
dist_version=`grep '.*"version".*:.*' package.json | sed 's/,//g' | sed 's/.*:.*"\(.*\)"$/\1/g'`
dist_name_prefix=`grep '.*"name".*:.*' package.json | sed 's/,//g' | sed 's/\@//g' | sed 's/\//-/g' | sed 's/.*:.*"\(.*\)"$/\1/g'`
dist_name_zip="${dist_name_prefix}-${dist_version}.zip"
(
  cd "${module_dist}"
  rm -rf "${WORKING_DIR}/${module_zip}/${dist_name_zip}"
  zip -9r "${WORKING_DIR}/${module_zip}/${dist_name_zip}" . > /tmp/$$.zip.log 2>&1
  if [ $? -ne 0 ]; then
    echo "zip command failed ${WORKING_DIR}/${module_zip}/${dist_name_zip}: $?"
    echo "zip logs:"
    cat /tmp/$$.zip.log
    rm -rf /tmp/$$.*
    exit 2
  fi
)
if [ $? -ne 0 ]; then
  exit 2
fi

## deploy lambda
echo "create/update lambda"

# get module fully qualified path and file name
module_zip_path=`ls ${module_zip}/${dist_name_zip}`

# check if lambda exits:
# if yes, run "aws update-function-code"
# if no, run "aws create-function"

aws lambda get-function --function-name ${module_name} --profile ${AWS_PROFILE} --region ${AWS_REGION} >& /tmp/$$.get.lambda
if [ $? -ne 0 ]; then
    aws lambda create-function \
        --region ${AWS_REGION} \
        --function-name ${module_name} \
        --zip-file fileb://"${module_zip_path}" \
        --runtime nodejs12.x \
        --tracing-config Mode=PassThrough \
        --timeout 30 \
        --memory-size 128 \
        --environment Variables="{NODE_ENV=${NODE_ENV},ENV_PREFIX=${ENV_PREFIX}}" \
        --role ${AWS_LAMBDA_ROLE_ARN} \
        --handler ${module_export} \
        --profile ${AWS_PROFILE} >& /tmp/$$.lambda.create
    cat /tmp/$$.lambda.create
else
    aws lambda update-function-code \
        --region ${AWS_REGION} \
        --function-name ${module_name} \
        --zip-file fileb://"${module_zip_path}" \
        --profile ${AWS_PROFILE} >& /tmp/$$.lambda.update
    cat /tmp/$$.lambda.update
fi

# check for error
if [ $? -ne 0 ]; then
    echo "unable to create/update lambda"
    rm -rf /tmp/$$.*
    exit 4
fi

## clean up
rm -rf /tmp/$$.*
echo "done"
