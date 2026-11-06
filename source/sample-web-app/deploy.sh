#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Clean up on exit
trap trap_signals 0 INT QUIT KILL TERM
trap_signals() {
    rm -rf /tmp/$$*
}

#####################################################################
# PREFLIGHT CHECK
# AWS credentials come from the AWS CLI's default credential chain, for
# example the AWS_PROFILE environment variable that deployment/deploy.sh requires
if [ -z "${AWS_REGION}" -o \
     -z "${S3_BUCKET_NAME}" -o \
     -z "${CLOUDFRONT_DISTRIBUTION_ID}" ]; then
    echo "Missing environment variables.  Ensure following environment variables are set"
    echo "  AWS_REGION"
    echo "  S3_BUCKET_NAME"
    echo "  CLOUDFRONT_DISTRIBUTION_ID"
    echo "AWS credentials come from the AWS CLI's default credential chain (for example, set AWS_PROFILE)"
    exit 1
fi

if [ -z "$AWS_CLI_BIN" ]; then
    AWS_CLI_BIN="aws"
fi

#####################################################################
# MORE PREFLIGHT CHECK
# make sure that the working directory is the root project folder
if [ ! -d "dist" ]; then
   echo "Error locating required files and folders.  Missing one of the following in the working directory:"
   echo "    dist/"
   exit 1
fi


#####################################################################
# CHECK THE BUCKET OWNER
# upload only to a bucket that the account of the current AWS credentials owns, so that a wrong or
# reused bucket name can't send the web app to a bucket in another account.  `aws s3 cp` has no
# expected-bucket-owner option, so head-bucket checks the owner first
account_id="$("${AWS_CLI_BIN}" sts get-caller-identity --query Account --output text 2> /tmp/$$.aws.sts.log)"
if [ $? -ne 0 ] || [ -z "${account_id}" ]; then
    echo "Error reading the account of the current AWS credentials.  aws cli log:"
    cat /tmp/$$.aws.sts.log
    rm -rf /tmp/$$.*
    exit 2
fi
"${AWS_CLI_BIN}" s3api head-bucket --bucket "${S3_BUCKET_NAME}" \
    --expected-bucket-owner "${account_id}" \
    --region "${AWS_REGION}" > /tmp/$$.aws.s3api.log 2>&1
if [ $? -ne 0 ]; then
    echo "Error: bucket ${S3_BUCKET_NAME} doesn't exist or isn't owned by account ${account_id}.  aws cli log:"
    cat /tmp/$$.aws.s3api.log
    rm -rf /tmp/$$.*
    exit 2
fi


#####################################################################
# COPY WEB-UI DEPLOYABLE ARTIFACT TO S3
echo "Copying dist contents to Web UI S3 bucket: ${S3_BUCKET_NAME}"
cd dist
"${AWS_CLI_BIN}" s3 cp . "s3://${S3_BUCKET_NAME}" --recursive \
    --region "${AWS_REGION}" > /tmp/$$.aws.s3.log 2>&1
if [ $? -ne 0 ]; then
    echo "Error during copy to s3.  aws cli log:"
    cat /tmp/$$.aws.s3.log
    rm -rf /tmp/$$.*
    exit 3
fi


#####################################################################
# INVALIDATE CLOUDFRONT DISTRIBUTION CACHE
echo "Invalidating cloudfront distribution cache: ${CLOUDFRONT_DISTRIBUTION_ID}"
"${AWS_CLI_BIN}" cloudfront create-invalidation \
    --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
    --paths "/*" \
    --region "${AWS_REGION}" > /tmp/$$.aws.cloudfront.log 2>&1
if [ $? -ne 0 ]; then
    echo "Error invalidating cloudfront distribution ${CLOUDFRONT_DISTRIBUTION_ID}.  aws cli log:"
    cat /tmp/$$.aws.cloudfront.log
    rm -rf /tmp/$$.*
    exit 4
fi


#####################################################################
# CLEANUP
echo "Done!"
