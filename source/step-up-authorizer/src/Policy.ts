// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { PolicyDocument, Statement } from 'aws-lambda';

/* eslint-disable no-unused-vars */
enum PolicyDocumentEnum {
  POLICY_DOCUMENT_VERSION = '2012-10-17',
  POLICY_DOCUMENT_DEFAULT_ACTION = 'execute-api:Invoke'
}
/* eslint-enable no-unused-vars */

/**
 * Policy class that generates API Gateway Authorizer policy document
 */
class Policy {
  private effect: string;
  private resource: string;

  /**
   * C-TOR
   * @param {string} effect 'Allow' or 'Deny' strings
   * @param {string} resource protected resource
   */
  constructor(effect: string, resource: string) {
    this.effect = effect;
    this.resource = resource;
  }

  /**
   * Returns policy document based on effect and resource
   * @returns {PolicyDocument} policy document
   */
  public getPolicy(): PolicyDocument {
    const policyDocument = <PolicyDocument>{};
    policyDocument.Version = PolicyDocumentEnum.POLICY_DOCUMENT_VERSION;
    policyDocument.Statement = [];

    // create a statement
    const statement: Statement = <Statement>{
      Effect: this.effect,
      Resource: this.resource,
      Action: PolicyDocumentEnum.POLICY_DOCUMENT_DEFAULT_ACTION
    };

    // add statement to the policy document
    policyDocument.Statement.push(statement);

    return policyDocument;
  }
}

export { Policy };
