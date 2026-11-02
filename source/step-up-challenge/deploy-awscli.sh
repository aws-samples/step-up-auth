#!/bin/sh

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

## initialize and do some pre-flight checks
if [ -z "$AWS_PROFILE" -o -z "$AWS_REGION" -o -z "$AWS_LAMBDA_ROLE_ARN" -o -z "$ENV_PREFIX" -o -z "$COGNITO_UP_ARN" -o -z "$COGNITO_CLIENT_ID" ]; then
    echo "Missing environment variables.  Ensure following environment variables are set"
    echo "  AWS_PROFILE"
    echo "  AWS_REGION"
    echo "  AWS_LAMBDA_ROLE_ARN"
    echo "  ENV_PREFIX"
    echo "  COGNITO_UP_ARN"
    echo "  COGNITO_CLIENT_ID"
    echo "Optional environment variables"
    echo "  SESSION_TABLE_ITEM_TTL (step-up session lifetime in seconds, default 900)"
    echo "  DEPLOYMENT_ENV (NODE_ENV of the function, default production)"
    echo "The function's environment variables are set only when the function is created.  For an existing function, only the code is updated."
    exit 1
fi

# optional: SESSION_TABLE_ITEM_TTL (seconds) sets the step-up session lifetime.  default 900, the same as the CDK deployment
if [ -z "${SESSION_TABLE_ITEM_TTL}" ]; then
  SESSION_TABLE_ITEM_TTL=900
fi
case "${SESSION_TABLE_ITEM_TTL}" in
  *[!0-9]*) ttl_is_number=no ;;
  *) ttl_is_number=yes ;;
esac
if [ "${ttl_is_number}" != "yes" ] || [ "${SESSION_TABLE_ITEM_TTL}" -le 0 ]; then
  echo "SESSION_TABLE_ITEM_TTL must be a positive integer (seconds), got '${SESSION_TABLE_ITEM_TTL}'"
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
echo "COGNITO_UP_ARN: ${COGNITO_UP_ARN}"
echo "COGNITO_CLIENT_ID: ${COGNITO_CLIENT_ID}"
echo "SESSION_TABLE_ITEM_TTL: ${SESSION_TABLE_ITEM_TTL}"
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

aws lambda get-function --function-name ${module_name} --profile ${AWS_PROFILE} --region ${AWS_REGION} > /tmp/$$.get.lambda 2>&1
if [ $? -ne 0 ]; then
    aws lambda create-function \
        --region ${AWS_REGION} \
        --function-name ${module_name} \
        --zip-file fileb://"${module_zip_path}" \
        --runtime nodejs24.x \
        --tracing-config Mode=PassThrough \
        --timeout 30 \
        --memory-size 128 \
        --environment Variables="{NODE_ENV=${NODE_ENV},ENV_PREFIX=${ENV_PREFIX},COGNITO_ISSUER=https://cognito-idp.${AWS_REGION}.amazonaws.com,COGNITO_USER_POOL_ARN=${COGNITO_UP_ARN},COGNITO_CLIENT_ID=${COGNITO_CLIENT_ID},SESSION_TABLE_ITEM_TTL=${SESSION_TABLE_ITEM_TTL}}" \
        --role ${AWS_LAMBDA_ROLE_ARN} \
        --handler ${module_export} \
        --profile ${AWS_PROFILE} > /tmp/$$.lambda.create 2>&1
    lambda_rc=$?
    cat /tmp/$$.lambda.create
else
    aws lambda update-function-code \
        --region ${AWS_REGION} \
        --function-name ${module_name} \
        --zip-file fileb://"${module_zip_path}" \
        --profile ${AWS_PROFILE} > /tmp/$$.lambda.update 2>&1
    lambda_rc=$?
    cat /tmp/$$.lambda.update
fi

# check for error (exit status of the aws command, not of cat)
if [ ${lambda_rc} -ne 0 ]; then
    echo "unable to create/update lambda"
    rm -rf /tmp/$$.*
    exit 4
fi

## clean up
rm -rf /tmp/$$.*
echo "done"
