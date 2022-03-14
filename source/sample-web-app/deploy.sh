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
if [ -z "${AWS_REGION}" -o \
     -z "${S3_BUCKET_NAME}" -o \
     -z "${CLOUDFRONT_DISTRIBUTION_ID}" ]; then
    echo "Missing environment variables.  Ensure following environment variables are set"
    echo "  AWS_REGION"
    echo "  S3_BUCKET_NAME"
    echo "  CLOUDFRONT_DISTRIBUTION_ID"
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
# COPY WEB-UI DEPLOYABLE ARTIFACT TO S3
echo "Copying dist contents to Web UI S3 bucket: ${S3_BUCKET_NAME}"
cd dist
"${AWS_CLI_BIN}" s3 cp . "s3://${S3_BUCKET_NAME}" --recursive \
    --region ${AWS_REGION} \
    --profile ${AWS_PROFILE} > /tmp/$$.aws.s3.log 2>&1
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
    --region ${AWS_REGION} \
    --profile ${AWS_PROFILE} > /tmp/$$.aws.cloudfront.log 2>&1
if [ $? -ne 0 ]; then
    echo "Error invalidating cloudfront distribution ${CLOUDFRONT_DISTRIBUTION_ID}.  aws cli log:"
    cat /tmp/$$.aws.cloudfront.log
    rm -rf /tmp/$$.*
    exit 4
fi


#####################################################################
# CLEANUP
echo "Done!"
