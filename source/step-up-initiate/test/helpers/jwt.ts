// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Test helper: sign a JWT so the initiate handler can decode its `sub` claim.  The initiate handler only
// decodes (does not cryptographically verify) the access token, so the signature here is not checked;
// a real RS256 signature is produced only to keep the token well-formed.

import { createSign, generateKeyPairSync } from 'crypto';

export const TEST_KID = 'test-kid-1';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const base64url = (value: string): string => Buffer.from(value).toString('base64url');

/**
 * Sign a JWT with a throwaway test private key (RS256, kid TEST_KID)
 * @param {Record<string, unknown>} payload JWT claims
 * @returns {string} signed JWT
 */
export const signJwt = (payload: Record<string, unknown>): string => {
  const header = base64url(JSON.stringify({ kid: TEST_KID, alg: 'RS256' }));
  const body = base64url(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  signer.end();
  const signature = signer.sign(privateKey).toString('base64url');
  return `${header}.${body}.${signature}`;
};
