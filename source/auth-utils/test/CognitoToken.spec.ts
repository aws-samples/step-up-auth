// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, jest } from '@jest/globals';
import { CognitoToken } from '../lib/CognitoToken';

describe('CognitoToken test suite', () => {

  it('returns same token', () => {
    const tokenToTest = 'eyJraWQiOiJleGFtcGxlLWtpZC0xIiwiYWxnIjoiUlMyNTYifQ.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJjb2duaXRvOmdyb3VwcyI6WyJ1cy1lYXN0LTFfRVhBTVBMRTExX0V4YW1wbGVJZFAiXSwiZW1haWxfdmVyaWZpZWQiOmZhbHNlLCJpc3MiOiJodHRwczovL2NvZ25pdG8taWRwLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tL3VzLWVhc3QtMV9FWEFNUExFMTEiLCJwaG9uZV9udW1iZXJfdmVyaWZpZWQiOmZhbHNlLCJjb2duaXRvOnVzZXJuYW1lIjoidXNlcjEiLCJhdWQiOiIxZXhhbXBsZTIzNDU2Nzg5YWJjZGVmZ2hpaiIsInRva2VuX3VzZSI6ImlkIiwiYXV0aF90aW1lIjoxNjE0OTI3MTYyLCJwaG9uZV9udW1iZXIiOiIrMTU1NTU1NTAxMDAiLCJleHAiOjE2MTQ5MzA3NjIsImlhdCI6MTYxNDkyNzE2MiwiZW1haWwiOiJ1c2VyMUBleGFtcGxlLmNvbSJ9.ZmFrZS1zaWduYXR1cmU';
    const token = new CognitoToken(tokenToTest);

    expect(token.getToken()).toEqual(tokenToTest);
  });

  it('returns id token', () => {
    const tokenToTest = 'eyJraWQiOiJleGFtcGxlLWtpZC0xIiwiYWxnIjoiUlMyNTYifQ.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJjb2duaXRvOmdyb3VwcyI6WyJ1cy1lYXN0LTFfRVhBTVBMRTExX0V4YW1wbGVJZFAiXSwiZW1haWxfdmVyaWZpZWQiOmZhbHNlLCJpc3MiOiJodHRwczovL2NvZ25pdG8taWRwLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tL3VzLWVhc3QtMV9FWEFNUExFMTEiLCJwaG9uZV9udW1iZXJfdmVyaWZpZWQiOmZhbHNlLCJjb2duaXRvOnVzZXJuYW1lIjoidXNlcjEiLCJhdWQiOiIxZXhhbXBsZTIzNDU2Nzg5YWJjZGVmZ2hpaiIsInRva2VuX3VzZSI6ImlkIiwiYXV0aF90aW1lIjoxNjE0OTI3MTYyLCJwaG9uZV9udW1iZXIiOiIrMTU1NTU1NTAxMDAiLCJleHAiOjE2MTQ5MzA3NjIsImlhdCI6MTYxNDkyNzE2MiwiZW1haWwiOiJ1c2VyMUBleGFtcGxlLmNvbSJ9.ZmFrZS1zaWduYXR1cmU';
    const idToken = new CognitoToken(tokenToTest);

    expect(idToken.isIdToken()).toBeTruthy();
    expect(idToken.isAccessToken()).toBeFalsy();
    // eslint-disable-next-line jest/prefer-to-be
    expect(idToken.getUsernameClaim()).toEqual('user1');
    // eslint-disable-next-line jest/prefer-to-be
    expect(idToken.getStepUpClaim()).toEqual('');
    // eslint-disable-next-line jest/prefer-to-be
    expect(idToken.getRequestIdClaim()).toEqual('');
  });

  it('returns bearer access token', () => {
    const tokenToTest = 'Bearer eyJraWQiOiJleGFtcGxlLWtpZC0xIiwiYWxnIjoiUlMyNTYifQ.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJjb2duaXRvOmdyb3VwcyI6WyJ1cy1lYXN0LTFfRVhBTVBMRTExX0V4YW1wbGVJZFAiXSwidG9rZW5fdXNlIjoiYWNjZXNzIiwic2NvcGUiOiJvcGVuaWQgcHJvZmlsZSBlbWFpbCIsImF1dGhfdGltZSI6MTYxNDkyNzE2MiwiaXNzIjoiaHR0cHM6Ly9jb2duaXRvLWlkcC51cy1lYXN0LTEuYW1hem9uYXdzLmNvbS91cy1lYXN0LTFfRVhBTVBMRTExIiwiZXhwIjoxNjE0OTMwNzYyLCJpYXQiOjE2MTQ5MjcxNjIsInZlcnNpb24iOjIsImp0aSI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMiIsImNsaWVudF9pZCI6IjFleGFtcGxlMjM0NTY3ODlhYmNkZWZnaGlqIiwidXNlcm5hbWUiOiJ1c2VyMSJ9.ZmFrZS1zaWduYXR1cmU';
    const accessToken = new CognitoToken(tokenToTest);

    expect(accessToken.isAccessToken()).toBeTruthy();
    expect(accessToken.isIdToken()).toBeFalsy();
    // eslint-disable-next-line jest/prefer-to-be
    expect(accessToken.getUsernameClaim()).toEqual('user1');
  });

  it('throws error when token is invalid', () => {
    const tokenToTest = 'eyJjdHkiOiJKV1QiLCJlbmMiOiJBMjU2R0NNIiwiYWxnIjoiUlNBLU9BRVAifQ.ZmFrZS1lbmNyeXB0ZWQta2V5.ZmFrZS1pdg.ZmFrZS1jaXBoZXJ0ZXh0.ZmFrZS10YWc';
    const accessToken = new CognitoToken(tokenToTest);

    try {
      accessToken.isAccessToken();

    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    catch ( e: any ) {
      // eslint-disable-next-line jest/no-conditional-expect, jest/prefer-to-be
      expect(e.message).toEqual('invalid token');
    }

    try {
      accessToken.isIdToken();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    catch ( e: any ) {
      // eslint-disable-next-line jest/no-conditional-expect, jest/prefer-to-be
      expect(e.message).toEqual('invalid token');
    }
  });
});
