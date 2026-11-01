// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface CloudfrontProps extends cdk.StackProps {
  readonly bucket: s3.Bucket;
}

export class CloudfrontStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: CloudfrontProps) {
    super(scope, id, props);

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      // OAI rather than OAC: with the bucket in its own stack, CDK's OAC bucket
      // policy would reference this distribution and create a cross-stack cycle.
      defaultBehavior: { origin: origins.S3BucketOrigin.withOriginAccessIdentity(props.bucket) },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // ----------------------------------------
    //           export values
    // ----------------------------------------
    new CfnOutput(this, "CloudfrontDistributionId", {
      value: this.distribution.distributionId
    });
    new CfnOutput(this, "CloudfrontDistributionDomainName", {
      value: this.distribution.distributionDomainName
    });
  }
}
