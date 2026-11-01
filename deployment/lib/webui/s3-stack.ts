// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface S3Props extends cdk.StackProps {
  readonly env: cdk.Environment;
}

export class S3Stack extends cdk.Stack {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: S3Props) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: `step-up-auth-web-ui-${props.env.account}-${props.env.region}`,
      // private bucket: CloudFront reads it through an origin access identity
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // sample resources: `cdk destroy` empties and removes the bucket
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
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
