// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from '@jest/globals';
import { PolicyDocument, Statement } from 'aws-lambda';
import { Policy } from '../../src/Policy';

describe('Policy test suite', () => {
  it('returns policy document', () => {
    // values to test
    const effect = 'Allow';
    const resource = '*';
    const policyDocumentToTest = <PolicyDocument>{};
    policyDocumentToTest.Version = '2012-10-17';
    policyDocumentToTest.Statement = [];
    const statement: Statement = <Statement>{
      Effect: effect,
      Resource: resource,
      Action: 'execute-api:Invoke'
    };
    policyDocumentToTest.Statement.push(statement);

    // create policy document
    const policy: Policy = new Policy(effect, resource);

    // assert
    expect(policy.getPolicy()).toEqual(policyDocumentToTest);
  });

});
