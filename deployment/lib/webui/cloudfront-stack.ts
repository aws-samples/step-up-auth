// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface CloudfrontProps extends cdk.StackProps {
  readonly env: cdk.Environment;
}

/**
 * Web UI hosting: the private web bucket, the access-log bucket and the CloudFront distribution.  The
 * web bucket and the distribution are in one stack so that the bucket policy can grant read access to
 * this one distribution through an origin access control (OAC).
 */
export class CloudfrontStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly accessLogBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: CloudfrontProps) {
    super(scope, id, props);

    // ----------------------------------------
    //           access-log bucket
    // ----------------------------------------
    // receives the CloudFront access logs and the web bucket's server access logs, and deletes them
    // after 30 days.  CloudFront standard logging writes its log files with object ACLs, so this bucket
    // keeps ACLs enabled (object writer); public access is still blocked.
    this.accessLogBucket = new s3.Bucket(this, 'AccessLogBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [{
        expiration: cdk.Duration.days(30),
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(1)
      }],
      // sample resources: `cdk destroy` empties and removes the bucket
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // Wildcard rationale: autoDeleteObjects makes CDK add a statement to this bucket's policy that
      // lets CDK's auto-delete function use s3:GetBucket*, s3:List*, s3:DeleteObject* and
      // s3:PutBucketPolicy on this bucket and on its objects (<bucket>/*).  When the stack is deleted,
      // the function reads the bucket's tags and policy (GetBucketTagging, GetBucketPolicy), denies new
      // uploads (PutBucketPolicy), lists every object version (ListBucketVersions) and deletes each one
      // (DeleteObject, DeleteObjectVersion).  The object keys aren't known when the stack is
      // synthesized, so the resource is <bucket>/*; CDK's Bucket construct sets the action families,
      // and the statement names this bucket only.
      // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.BucketProps.html#autodeleteobjects
      autoDeleteObjects: true
    });

    // ----------------------------------------
    //              web bucket
    // ----------------------------------------
    this.bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: `step-up-auth-web-ui-${props.env.account}-${props.env.region}`,
      // private bucket: only this CloudFront distribution reads it, through the origin access control
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Wildcard rationale: server access logging makes CDK add a statement to the access-log bucket's
      // policy that lets the S3 logging service (logging.s3.amazonaws.com) call s3:PutObject on
      // <access-log bucket>/web-bucket/*, only for the logs of this bucket (aws:SourceArn) in this
      // account (aws:SourceAccount).  S3 names each log object when it delivers it (the prefix, the
      // date and time, and a unique string), so the resource is the prefix with a wildcard.
      // https://docs.aws.amazon.com/AmazonS3/latest/userguide/enable-server-access-logging.html
      serverAccessLogsBucket: this.accessLogBucket,
      serverAccessLogsPrefix: 'web-bucket/',
      lifecycleRules: [{
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(7)
      }],
      // sample resources: `cdk destroy` empties and removes the bucket
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // Wildcard rationale: autoDeleteObjects makes CDK add a statement to this bucket's policy that
      // lets CDK's auto-delete function use s3:GetBucket*, s3:List*, s3:DeleteObject* and
      // s3:PutBucketPolicy on this bucket and on its objects (<bucket>/*).  When the stack is deleted,
      // the function reads the bucket's tags and policy (GetBucketTagging, GetBucketPolicy), denies new
      // uploads (PutBucketPolicy), lists every object version (ListBucketVersions) and deletes each one
      // (DeleteObject, DeleteObjectVersion).  The object keys aren't known when the stack is
      // synthesized, so the resource is <bucket>/*; CDK's Bucket construct sets the action families,
      // and the statement names this bucket only.
      // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.BucketProps.html#autodeleteobjects
      autoDeleteObjects: true
    });

    // ----------------------------------------
    //       response security headers
    // ----------------------------------------
    // the web app must not be framed by another site (clickjacking), its forms can submit only to its
    // own origin (form-action, which has no default-src fallback), it is served over HTTPS only (HSTS)
    // and is not content-sniffed
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      comment: 'step-up-auth web app security headers',
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: "frame-ancestors 'none'; form-action 'self'", override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true
        },
        contentTypeOptions: { override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true
        }
      }
    });

    // ----------------------------------------
    //        CloudFront distribution
    // ----------------------------------------
    // The distribution uses the default *.cloudfront.net certificate.  Its TLS security policy can only
    // be chosen with a custom domain and an ACM certificate (minimumProtocolVersion has no effect
    // without one); see "Security model and limitations" in the README.
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        // origin access control: the bucket policy lets only this distribution read the bucket.
        // Wildcard rationale: CDK adds a statement to the web bucket's policy that lets
        // cloudfront.amazonaws.com call s3:GetObject on <web bucket>/*, only for requests from this
        // distribution (AWS:SourceArn).  The distribution serves every file of the web app build
        // (index.html, the JavaScript bundles, the style sheets and the images, whose names and number
        // the webpack build decides), so the resource is the bucket's objects, not a list of keys.
        // https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: securityHeaders
      },
      defaultRootObject: 'index.html',
      enableLogging: true,
      logBucket: this.accessLogBucket,
      logFilePrefix: 'cloudfront/',
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
    new CfnOutput(this, "CloudfrontDistributionId", {
      value: this.distribution.distributionId
    });
    new CfnOutput(this, "CloudfrontDistributionDomainName", {
      value: this.distribution.distributionDomainName
    });
  }
}
