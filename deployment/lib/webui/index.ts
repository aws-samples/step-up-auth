// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { CloudfrontStack } from './cloudfront-stack';

export interface WebUIProps {
  readonly env: cdk.Environment;
}

export class WebUI extends Construct {

  constructor(scope: Construct, id: string, props: WebUIProps) {
    super(scope, id);

    // create the CloudFront Stack: the web bucket, its access-log bucket and the distribution.  The web
    // bucket is in the same stack as the distribution so that its policy can name this distribution.
    new CloudfrontStack(this, 'Cloudfront', {
      env: props.env,
    });
  }
}
