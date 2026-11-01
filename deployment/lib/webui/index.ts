// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { S3Stack } from './s3-stack';
import { CloudfrontStack } from './cloudfront-stack';

export interface WebUIProps {
  readonly env: cdk.Environment;
}

export class WebUI extends Construct {

  constructor(scope: Construct, id: string, props: WebUIProps) {
    super(scope, id);

    // create S3 Stack to host Web UI
    const s3Stack = new S3Stack(this, 'S3', {
      env: props.env,
    });

    // create CloudFront Stack
    new CloudfrontStack(this, 'Cloudfront', {
      env: props.env,
      bucket: s3Stack.bucket,
    });
  }
}
