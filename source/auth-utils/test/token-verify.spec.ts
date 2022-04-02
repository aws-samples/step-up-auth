// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, jest } from '@jest/globals';

import * as jwt from 'jsonwebtoken';
import jwkToPem from 'jwk-to-pem';

interface CognitoUserPoolKeyInstance {
  alg: string,
  e: string,
  kid: string,
  kty: string,
  n: string,
  use: string
}

interface CognitoUserPoolKey {
  instance: CognitoUserPoolKeyInstance,
  pem: string
}
interface CognitoUserPoolKeys {
  [key: string]: CognitoUserPoolKey
}

describe('token verification test suite', () => {

  it('verify access token', () => {

    const jwksKeys = {"keys":[{"alg":"RS256","e":"AQAB","kid":"gQpiUD80i1clqVSTeCVFv9QqAFqLTMfsxqmOfhF6B5Q=","kty":"RSA","n":"lIDWCMwekpg2iN1fYByRNETiLeTOWW5dMfzO7Csxgc683BQYS-TRd7McdZU2c9JyZMyt2mQlXlLJGU1KGGLo3nrC92j0pS7GlOB_kQFXd6fPYrROm6ROQXHL5tJm-mSeRTtsGqAxJMNGUe9fPWnNuGwHYxpqhORxDgQZOtsJaZ8GsCUpByE_cjLfdfLjMTAX5wqiJpmT91a59N4QuJofkinaVoP7vzPTtiyYwdZiWvzKrSBaLFIcOq_TPsYxepFW8GB7ewpdKbdcoTrqQ59R58l_HxHV_taU0XyNKAcrnsMD8QeEN-fqvNNP6FY2YUTLP5ZrNsWKQtEM_juWwCUaUw","use":"sig"},{"alg":"RS256","e":"AQAB","kid":"Ob3sVovGdh62Pp9TLNibzCEhRwbhLjhkxygoCJzoYWQ=","kty":"RSA","n":"njcpd8hDHaIbf0ZlswM171sW7RW7ahVJWRPZnw5Svx5Be0arc9djMP9CQNQH24yydKLkD-nH-gt3pKJHdIKEZnYou5utsKOhqZ40CGSzvBgV9ZRGxSQ6sKXXKwuYagjqvgjSVHbzI_Msf4iOI2tYXmdtqLa3LSmLkyhZRorsFUGqYXiPT_QK1Xol0ZyL1xLtaVln4uUD2hoLZSn_Nu-8he1pfrmrXnLmry4sPipZztdTivoo77raeCzT-RpV15OD-amREBU0cHX_-rANcdv6PxKis7dOvQi1NE_pxHzVsJeLUN8KPmk3ni8WrupD0dWutkx503T3Ag6caLBgez3onQ","use":"sig"}]};
    const accessToken = 'eyJraWQiOiJPYjNzVm92R2RoNjJQcDlUTE5pYnpDRWhSd2JoTGpoa3h5Z29DSnpvWVdRPSIsImFsZyI6IlJTMjU2In0.eyJzdWIiOiIxYmMyYThmYi1mYzBhLTQ0MGYtOTNhZS01NzZlMDg3OWQxODAiLCJjb2duaXRvOmdyb3VwcyI6WyJ1cy1lYXN0LTFfaVdjVFBoWkJBX2FkZnMiXSwidG9rZW5fdXNlIjoiYWNjZXNzIiwic2NvcGUiOiJvcGVuaWQgcHJvZmlsZSBlbWFpbCIsImF1dGhfdGltZSI6MTYxNzk1NDg0OCwiaXNzIjoiaHR0cHM6XC9cL2NvZ25pdG8taWRwLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tXC91cy1lYXN0LTFfaVdjVFBoWkJBIiwiZXhwIjoxNjE3OTU1NzQ4LCJpYXQiOjE2MTc5NTQ4NTEsInZlcnNpb24iOjIsImp0aSI6IjkzZTZlOTg4LWMzMjItNGIxYi05ZTU5LTNkZDY4YWRhMDFkOSIsImNsaWVudF9pZCI6IjZpMG82c2VsYTE1amRjdGdlZmxrbWo0Z2pvIiwidXNlcm5hbWUiOiJhZGZzX21vZ2hhbHNcXGJvYiJ9.ddHGG1Egjpn0IX9KadH_1-eI33DpEJ1ldPbJk0yYCItbdz3KCA2zY-Ho9KTMN9HZoGWvN5o-6CQKAjEPqpO9qr5YWVMrSMno2jmPUFCkHGIQ7ns10Mt6rvh7D62kTWjXtkXje2kShhYPnOAtVx9lZxvHQRaSYCqpurtpImOoKaxjx3jlQ_ldjOQLXBBhvA2o6SOxo93ZpXFKExaI_yYI4SVLiFHtrjSucpcyiM9RyoR3sptZG502nnJsNTXrDXHg2SedaH4gCXfCc3g2A7Og4trfLdVB_IpzSj-2K4XCVuO0SX2f_l7MboSKbcrHTDbkySF_ISipvBNVD6XVeB5Tmg';

    // convert keys to pem
    const publicKeys: CognitoUserPoolKeys = jwksKeys.keys.reduce( (accumulator: CognitoUserPoolKeys, currentValue: CognitoUserPoolKeyInstance) => {
      const jwkBuff = <jwkToPem.JWK> {
        kty: currentValue.kty,
        e: currentValue.e,
        n: currentValue.n
      };
      const pem = jwkToPem(jwkBuff);

      accumulator[currentValue.kid] = {
        instance: currentValue,
        pem
      };
      return accumulator;
    }, {});

    console.log(publicKeys);

    // access token verification
    const accessTokenSections = (accessToken || '').split('.');
    const accessTokenHeaderJSON = Buffer.from(accessTokenSections[0], 'base64').toString('utf8');
    const accessTokenHeader = JSON.parse(accessTokenHeaderJSON);
    const accessTokenKey = publicKeys[accessTokenHeader.kid];
    console.log(accessTokenKey.pem);

    // value to test
    const expectedErrorMessage = 'jwt expired';
    let errorMessage = '';
    try {
      jwt.verify(accessToken, accessTokenKey.pem);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    catch ( e: any ) {
      errorMessage = e.message;
    }

    expect(errorMessage).toEqual(expectedErrorMessage);
  });

  it('verify id token', () => {

    const jwksKeys = {"keys":[{"alg":"RS256","e":"AQAB","kid":"gQpiUD80i1clqVSTeCVFv9QqAFqLTMfsxqmOfhF6B5Q=","kty":"RSA","n":"lIDWCMwekpg2iN1fYByRNETiLeTOWW5dMfzO7Csxgc683BQYS-TRd7McdZU2c9JyZMyt2mQlXlLJGU1KGGLo3nrC92j0pS7GlOB_kQFXd6fPYrROm6ROQXHL5tJm-mSeRTtsGqAxJMNGUe9fPWnNuGwHYxpqhORxDgQZOtsJaZ8GsCUpByE_cjLfdfLjMTAX5wqiJpmT91a59N4QuJofkinaVoP7vzPTtiyYwdZiWvzKrSBaLFIcOq_TPsYxepFW8GB7ewpdKbdcoTrqQ59R58l_HxHV_taU0XyNKAcrnsMD8QeEN-fqvNNP6FY2YUTLP5ZrNsWKQtEM_juWwCUaUw","use":"sig"},{"alg":"RS256","e":"AQAB","kid":"Ob3sVovGdh62Pp9TLNibzCEhRwbhLjhkxygoCJzoYWQ=","kty":"RSA","n":"njcpd8hDHaIbf0ZlswM171sW7RW7ahVJWRPZnw5Svx5Be0arc9djMP9CQNQH24yydKLkD-nH-gt3pKJHdIKEZnYou5utsKOhqZ40CGSzvBgV9ZRGxSQ6sKXXKwuYagjqvgjSVHbzI_Msf4iOI2tYXmdtqLa3LSmLkyhZRorsFUGqYXiPT_QK1Xol0ZyL1xLtaVln4uUD2hoLZSn_Nu-8he1pfrmrXnLmry4sPipZztdTivoo77raeCzT-RpV15OD-amREBU0cHX_-rANcdv6PxKis7dOvQi1NE_pxHzVsJeLUN8KPmk3ni8WrupD0dWutkx503T3Ag6caLBgez3onQ","use":"sig"}]};
    const idToken = 'eyJraWQiOiJnUXBpVUQ4MGkxY2xxVlNUZUNWRnY5UXFBRnFMVE1mc3hxbU9maEY2QjVRPSIsImFsZyI6IlJTMjU2In0.eyJhdF9oYXNoIjoiU1JvQ1dGRUtCZU9CV3kyWWp6b0ZHQSIsInN1YiI6IjFiYzJhOGZiLWZjMGEtNDQwZi05M2FlLTU3NmUwODc5ZDE4MCIsImNvZ25pdG86Z3JvdXBzIjpbInVzLWVhc3QtMV9pV2NUUGhaQkFfYWRmcyJdLCJlbWFpbF92ZXJpZmllZCI6ZmFsc2UsImRldmljZV9pZCI6IiIsImN1c3RvbTpsYXN0TG9naW4iOiI5OS4yNDYuNi4yMDkiLCJpc3MiOiJodHRwczpcL1wvY29nbml0by1pZHAudXMtZWFzdC0xLmFtYXpvbmF3cy5jb21cL3VzLWVhc3QtMV9pV2NUUGhaQkEiLCJwaG9uZV9udW1iZXJfdmVyaWZpZWQiOmZhbHNlLCJjdXN0b206ZmZwIjoibW9naGFsc1xcYm9iIiwiY29nbml0bzp1c2VybmFtZSI6ImFkZnNfbW9naGFsc1xcYm9iIiwibm9uY2UiOiJhSEpuNG9Jb3pkWDFyVXdXcVFMeHhBZk9uYUFwMk5MdWk1SFI5ZVBVT1NrQ0NHd25vel9YZU41NlQwd3psb3pKdEpKb2RMOUpGVi1wS2Y2aThYRGlPUmJYZmF0c1FGZHZCZVB6VjRJa3NhQ21IOE5tUzhRcGotQmFyN1pPeGZxRmxMSFNOZG83OEd0RjNnYlRsb0VZanJKaFdtdkxoV0N0VjdsSmthUlBscTQiLCJhdWQiOiI2aTBvNnNlbGExNWpkY3RnZWZsa21qNGdqbyIsImlkZW50aXRpZXMiOlt7InVzZXJJZCI6Im1vZ2hhbHNcXGJvYiIsInByb3ZpZGVyTmFtZSI6ImFkZnMiLCJwcm92aWRlclR5cGUiOiJTQU1MIiwiaXNzdWVyIjoiaHR0cDpcL1wvc3RzLm1vZ2hhbHMuY2NcL2FkZnNcL3NlcnZpY2VzXC90cnVzdCIsInByaW1hcnkiOiJ0cnVlIiwiZGF0ZUNyZWF0ZWQiOiIxNjE2NzM4NjYyNjM1In1dLCJ0b2tlbl91c2UiOiJpZCIsImF1dGhfdGltZSI6MTYxNzk1NDg0OCwicGhvbmVfbnVtYmVyIjoiKzQ0MDIwNzk0NjAxMjMiLCJleHAiOjE2MTc5NTU3NDgsImlhdCI6MTYxNzk1NDg0OCwiZW1haWwiOiJib2JAbW9naGFscy5jYyJ9.EFHUmkJGroB4S8GJ3mzo_oGIZw8udEeoun8W7W1nDIhWKn4tap4c0mSgBvWc4NiUuHDLQsFCnKENxWuEymTAXXL-5canhYFVFNZ_bcNfPfYKCqqCkTxsPj2pvkLbIdDkCUpAE_R5ErnUUSnQt9FR9Lzo3939YRQR7QjEIu8qR3t9sqZ4HYcMBlSfKiIYJHoTMzRp5ZX3Ohpj0QUPmE07nil5Acvx-ex-lg7IjohSCMzA9db861W7FMB19hjly8GZSTQwH_2pCZc_tM31vMEmRq5zSDc7k7LA-qvDQWMPgPwH2qcfkMXaFk1cm9rJkNyfbMLF81QcP90EPmBNZRYAHw';

    // convert keys to pem
    const publicKeys: CognitoUserPoolKeys = jwksKeys.keys.reduce( (accumulator: CognitoUserPoolKeys, currentValue: CognitoUserPoolKeyInstance) => {
      const jwkBuff = <jwkToPem.JWK> {
        kty: currentValue.kty,
        e: currentValue.e,
        n: currentValue.n
      };
      const pem = jwkToPem(jwkBuff);

      accumulator[currentValue.kid] = {
        instance: currentValue,
        pem
      };
      return accumulator;
    }, {});

    console.log(publicKeys);

    // id token verification
    const idTokenSections = (idToken || '').split('.');
    const idTokenHeaderJSON = Buffer.from(idTokenSections[0], 'base64').toString('utf8');
    const idTokenHeader = JSON.parse(idTokenHeaderJSON);
    const idTokenKey = publicKeys[idTokenHeader.kid];
    console.log(idTokenKey.pem);

    // value to test
    const expectedErrorMessage = 'jwt expired';
    let errorMessage = '';
    try {
      jwt.verify(idToken, idTokenKey.pem);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    catch ( e: any ) {
      errorMessage = e.message;
    }

    expect(errorMessage).toEqual(expectedErrorMessage);
  });

});
