// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Test helper: an in-memory RSA key pair that signs RS256 JWTs, plus the matching public JWK.  The
// initiate handler now cryptographically verifies the caller's access token with aws-jwt-verify, so
// prime the verifier with `cacheJwks({ keys: [testJwk] })` to keep verification offline.  Always sign
// with TEST_KID: an unknown kid makes aws-jwt-verify fetch the JWKS over the network.

import { createSign, generateKeyPairSync } from 'crypto';

export const TEST_KID = 'test-kid-1';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const exportedJwk = publicKey.export({ format: 'jwk' });

export const testJwk = {
  kty: 'RSA',
  n: exportedJwk.n as string,
  e: exportedJwk.e as string,
  kid: TEST_KID,
  alg: 'RS256',
  use: 'sig',
};

const base64url = (value: string): string => Buffer.from(value).toString('base64url');

/**
 * Sign a JWT with the test private key (RS256, kid TEST_KID)
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
