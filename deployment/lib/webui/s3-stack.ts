// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import { CfnOutput } from "@aws-cdk/core";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface S3Props extends cdk.StackProps {
  readonly env: cdk.Environment;
}

export class S3Stack extends cdk.Stack {
  public readonly bucket: s3.Bucket;

  constructor(scope: cdk.Construct, id: string, props: S3Props) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: `step-up-auth-web-ui-${props.env.account}-${props.env.region}`
    });

    // ----------------------------------------
    //           export values
    // ----------------------------------------
    new CfnOutput(this, "WebUiBucketName", {
      value: this.bucket.bucketName,
    });
    new CfnOutput(this, "WebUiBucketArn", {
      value: this.bucket.bucketArn,
    });
    new CfnOutput(this, "WebUiBucketDomainName", {
      value: this.bucket.bucketDomainName,
    });
    new CfnOutput(this, "WebUiBucketRegionalDomainName", {
      value: this.bucket.bucketRegionalDomainName,
    });
  }
}
