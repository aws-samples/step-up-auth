// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/** Retention of the Lambda function and API Gateway log groups */
export const LOG_RETENTION = logs.RetentionDays.ONE_MONTH;

export interface FunctionRole {
  /** the function's own execution role */
  readonly role: iam.Role;
  /** the function's own log group, the only log group the role can write */
  readonly logGroup: logs.LogGroup;
}

/**
 * Create the log group and the execution role of one Lambda function.  Each function gets its own
 * role, and the role starts with one permission: write the function's own log group.  The caller adds
 * the table and user pool actions the function makes, on those resources only.  The log group has an
 * explicit retention and is removed with the stack.
 * @param {Construct} scope construct that owns the role and the log group (the function's stack)
 * @param {string} id prefix for the construct ids
 * @returns {FunctionRole} role and log group
 */
export function createFunctionRole(scope: Construct, id: string): FunctionRole {
  const logGroup = new logs.LogGroup(scope, `${id}-log-group`, {
    retention: LOG_RETENTION,
    removalPolicy: cdk.RemovalPolicy.DESTROY
  });
  const role = new iam.Role(scope, `${id}-role`, {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
  });
  role.addToPolicy(new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
    resources: [logGroup.logGroupArn]
  }));
  return { role, logGroup };
}
