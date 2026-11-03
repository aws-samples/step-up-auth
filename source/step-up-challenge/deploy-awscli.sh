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
    echo "  STEP_UP_MAX_REAUTH_AGE (max age of the accepted re-authentication in seconds, default 120, range 30-900)"
    echo "  STEP_UP_CHALLENGE_CLOCK_SKEW (allowance for 'authenticated after the challenge' in seconds, default 1, range 0-10)"
    echo "  STEP_UP_REAUTH_FUTURE_SKEW (allowance for a future-dated auth_time in seconds, default 5, range 0-10)"
    echo "  DEPLOYMENT_ENV (NODE_ENV of the function, default production)"
    echo "For an existing function, the script replaces the function's environment variables with these values and then updates the code."
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

# optional: STEP_UP_MAX_REAUTH_AGE (seconds) max age of the accepted re-authentication.  default 120, range 30-900, the same as the CDK deployment
if [ -z "${STEP_UP_MAX_REAUTH_AGE}" ]; then
  STEP_UP_MAX_REAUTH_AGE=120
fi
case "${STEP_UP_MAX_REAUTH_AGE}" in
  *[!0-9]*) max_age_is_number=no ;;
  *) max_age_is_number=yes ;;
esac
if [ "${max_age_is_number}" != "yes" ] || [ "${STEP_UP_MAX_REAUTH_AGE}" -lt 30 ] || [ "${STEP_UP_MAX_REAUTH_AGE}" -gt 900 ]; then
  echo "STEP_UP_MAX_REAUTH_AGE must be a whole number of seconds between 30 and 900, got '${STEP_UP_MAX_REAUTH_AGE}'"
  exit 1
fi

# optional: STEP_UP_CHALLENGE_CLOCK_SKEW (seconds) allowance for the 'authenticated after the challenge' check.  default 1, range 0-10, the same as the CDK deployment
if [ -z "${STEP_UP_CHALLENGE_CLOCK_SKEW}" ]; then
  STEP_UP_CHALLENGE_CLOCK_SKEW=1
fi
case "${STEP_UP_CHALLENGE_CLOCK_SKEW}" in
  *[!0-9]*) challenge_skew_is_number=no ;;
  *) challenge_skew_is_number=yes ;;
esac
if [ "${challenge_skew_is_number}" != "yes" ] || [ "${STEP_UP_CHALLENGE_CLOCK_SKEW}" -lt 0 ] || [ "${STEP_UP_CHALLENGE_CLOCK_SKEW}" -gt 10 ]; then
  echo "STEP_UP_CHALLENGE_CLOCK_SKEW must be a whole number of seconds between 0 and 10, got '${STEP_UP_CHALLENGE_CLOCK_SKEW}'"
  exit 1
fi

# optional: STEP_UP_REAUTH_FUTURE_SKEW (seconds) allowance for a future-dated auth_time.  default 5, range 0-10, the same as the CDK deployment
if [ -z "${STEP_UP_REAUTH_FUTURE_SKEW}" ]; then
  STEP_UP_REAUTH_FUTURE_SKEW=5
fi
case "${STEP_UP_REAUTH_FUTURE_SKEW}" in
  *[!0-9]*) future_skew_is_number=no ;;
  *) future_skew_is_number=yes ;;
esac
if [ "${future_skew_is_number}" != "yes" ] || [ "${STEP_UP_REAUTH_FUTURE_SKEW}" -lt 0 ] || [ "${STEP_UP_REAUTH_FUTURE_SKEW}" -gt 10 ]; then
  echo "STEP_UP_REAUTH_FUTURE_SKEW must be a whole number of seconds between 0 and 10, got '${STEP_UP_REAUTH_FUTURE_SKEW}'"
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
echo "STEP_UP_MAX_REAUTH_AGE: ${STEP_UP_MAX_REAUTH_AGE}"
echo "STEP_UP_CHALLENGE_CLOCK_SKEW: ${STEP_UP_CHALLENGE_CLOCK_SKEW}"
echo "STEP_UP_REAUTH_FUTURE_SKEW: ${STEP_UP_REAUTH_FUTURE_SKEW}"
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

# function environment, used when the function is created and when it is updated
lambda_environment="Variables={NODE_ENV=${NODE_ENV},ENV_PREFIX=${ENV_PREFIX},COGNITO_ISSUER=https://cognito-idp.${AWS_REGION}.amazonaws.com,COGNITO_USER_POOL_ARN=${COGNITO_UP_ARN},COGNITO_CLIENT_ID=${COGNITO_CLIENT_ID},SESSION_TABLE_ITEM_TTL=${SESSION_TABLE_ITEM_TTL},STEP_UP_MAX_REAUTH_AGE=${STEP_UP_MAX_REAUTH_AGE},STEP_UP_CHALLENGE_CLOCK_SKEW=${STEP_UP_CHALLENGE_CLOCK_SKEW},STEP_UP_REAUTH_FUTURE_SKEW=${STEP_UP_REAUTH_FUTURE_SKEW}}"

# check if lambda exits:
# if yes, run "aws update-function-configuration", wait for it to finish, then run "aws update-function-code"
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
        --environment "${lambda_environment}" \
        --role ${AWS_LAMBDA_ROLE_ARN} \
        --handler ${module_export} \
        --profile ${AWS_PROFILE} > /tmp/$$.lambda.create 2>&1
    lambda_rc=$?
    cat /tmp/$$.lambda.create
else
    # update the environment first, so the new code never runs with an old SESSION_TABLE_ITEM_TTL
    aws lambda update-function-configuration \
        --region ${AWS_REGION} \
        --function-name ${module_name} \
        --environment "${lambda_environment}" \
        --profile ${AWS_PROFILE} > /tmp/$$.lambda.config 2>&1
    lambda_rc=$?
    cat /tmp/$$.lambda.config
    if [ ${lambda_rc} -eq 0 ]; then
        # lambda rejects a code update while the configuration update is in progress
        aws lambda wait function-updated \
            --region ${AWS_REGION} \
            --function-name ${module_name} \
            --profile ${AWS_PROFILE} > /tmp/$$.lambda.wait 2>&1
        lambda_rc=$?
        cat /tmp/$$.lambda.wait
    fi
    if [ ${lambda_rc} -eq 0 ]; then
        aws lambda update-function-code \
            --region ${AWS_REGION} \
            --function-name ${module_name} \
            --zip-file fileb://"${module_zip_path}" \
            --profile ${AWS_PROFILE} > /tmp/$$.lambda.update 2>&1
        lambda_rc=$?
        cat /tmp/$$.lambda.update
    fi
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
