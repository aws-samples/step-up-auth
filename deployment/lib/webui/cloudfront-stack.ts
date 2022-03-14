// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as origins from '@aws-cdk/aws-cloudfront-origins';
import { CfnOutput } from "@aws-cdk/core";

export interface CloudfrontProps extends cdk.StackProps {
  readonly bucket: s3.Bucket;
}

export class CloudfrontStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: cdk.Construct, id: string, props: CloudfrontProps) {
    super(scope, id, props);

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: { origin: new origins.S3Origin(props.bucket) },
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
