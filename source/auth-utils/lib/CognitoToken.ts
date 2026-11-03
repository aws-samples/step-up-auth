// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { jwtDecode, JwtPayload } from 'jwt-decode';
import * as crypto from "crypto";
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { CognitoJwtVerifierSingleUserPool } from 'aws-jwt-verify/cognito-verifier';
import { Logger } from './Logger';

// initialize Logger
import * as path from 'path';
const fileName = path.basename(__filename);
const log = new Logger(fileName);

/**
 * Identities payload present in Cognito Identity Token
 */
type CognitoIdentity = {
  userId?: string;
  providerName?: string;
  providerType?: string;
  issuer?: string;
  primary?: string;
  dateCreated?: string;
};

/**
 * Cognito Identity Token Payload
 */
interface CognitoIdentityTokenPayload extends JwtPayload {
  sub: string;
  iss: string;
  token_use: string;
  aud: string;
  exp: number;
  iat: number;
  'cognito:groups': string[] | string;
  'cognito:username': string;
  at_hash?: string;
  email_verified?: boolean;
  phone_number_verified?: boolean;
  nonce?: string;
  auth_time?: number;
  phone_number?: string;
  email?: string;
  identities?: CognitoIdentity[];
  device_id?: string;
  // custom claims that are used during step up auth
  step_up?: string;
  request_id?: string;
  // following claim is not officially part of identity token
  // we are simply telling TS compiler to be quiet!
  scope?: string;
  jti?: string;
}

/**
 * Cognito Access Token Payload
 */
interface CognitoAccessTokenPayload extends JwtPayload {
  sub: string;
  iss: string;
  exp: number;
  iat: number;
  token_use: string;
  jti?: string;
  'cognito:groups': string[] | string;
  scope?: string;
  auth_time?: number;
  version?: number;
  client_id?: string;
  username?: string;
}

/**
 * Value of the Cognito `token_use` claim
 */
type CognitoTokenUse = 'access' | 'id';

/**
 * Properties of a cached aws-jwt-verify verifier (one per user pool, token use and client id)
 */
type CognitoVerifierProperties = {
  userPoolId: string;
  tokenUse: CognitoTokenUse;
  clientId: string;
};
type CognitoVerifier = CognitoJwtVerifierSingleUserPool<CognitoVerifierProperties>;

/**
 * Cognito Token management utility class
 */
class CognitoToken {
  // verifiers are cached across instances (and warm Lambda invocations) so that
  // the user pool JWKS is downloaded once per verifier
  private static verifiers: Map<string, CognitoVerifier> = new Map();

  private token: string;
  // kept for API compatibility.  aws-jwt-verify derives the expected issuer from the user pool id
  private tokenIssuer?: string;
  private userPoolArn?: string;
  private clientId?: string;

  /**
   * C-TOR
   * @param {string} token value that represents a Bearer token
   * @param {string} tokenIssuer cognito token issuer url (optional, defaults to env COGNITO_ISSUER)
   * @param {string} userPoolArn cognito user pool arn (optional, defaults to env COGNITO_USER_POOL_ARN)
   * @param {string} clientId cognito app client id (optional, defaults to env COGNITO_CLIENT_ID)
   */
  constructor(token: string, tokenIssuer?: string, userPoolArn?: string, clientId?: string) {
    this.token = token;

    // do some token clean-up
    if (this.token && this.token.length > 0) {
      const re = /^Bearer (.*)$/;
      // if 'Bearer ' keyword (with a trailing space) is present, then remove it
      if (this.token.match(re)) {
        this.token = this.token.replace(re, "$1");
      }
    }

    // default tokenIssuer to constructor passed tokenIssuer
    // otherwise, read cognitoIssuer from environment variable 'COGNITO_ISSUER'
    if (tokenIssuer) {
      this.tokenIssuer = tokenIssuer;
    }
    else if (process.env.COGNITO_ISSUER) {
      this.tokenIssuer = process.env.COGNITO_ISSUER;
    }

    // default userPoolArn to constructor passed userPoolArn
    // otherwise, read userPoolArn from environment variable 'COGNITO_USER_POOL_ARN'
    // if all fails, leave userPoolArn as 'undefined'.  verify() then fails closed.
    if (userPoolArn) {
      this.userPoolArn = userPoolArn;
    }
    else if (process.env.COGNITO_USER_POOL_ARN) {
      this.userPoolArn = process.env.COGNITO_USER_POOL_ARN;
    }

    // default clientId to constructor passed clientId
    // otherwise, read clientId from environment variable 'COGNITO_CLIENT_ID'
    // if all fails, leave clientId as 'undefined'.  verify() then fails closed.
    if (clientId) {
      this.clientId = clientId;
    }
    else if (process.env.COGNITO_CLIENT_ID) {
      this.clientId = process.env.COGNITO_CLIENT_ID;
    }
  }

  /**
   * Return a cached aws-jwt-verify Cognito verifier for given user pool, token use and client id.
   * A verifier caches the user pool JWKS, so reusing it avoids a JWKS download per request.
   * @param {string} userPoolId cognito user pool id, e.g. us-east-1_XXXXXXXXX
   * @param {CognitoTokenUse} tokenUse expected `token_use` claim ('access' or 'id')
   * @param {string} clientId expected app client id (`client_id` claim of access token, `aud` claim of id token)
   * @returns {CognitoVerifier} verifier instance
   */
  public static getVerifier(userPoolId: string, tokenUse: CognitoTokenUse, clientId: string): CognitoVerifier {
    const key = `${userPoolId}|${tokenUse}|${clientId}`;
    let verifier = CognitoToken.verifiers.get(key);
    if (!verifier) {
      verifier = CognitoJwtVerifier.create({ userPoolId, tokenUse, clientId });
      CognitoToken.verifiers.set(key, verifier);
    }
    return verifier;
  }

  /**
   * Return the raw token value without `Bearer` keyword.
   * @returns {string} token
   */
  public getToken(): string {
    return this.token;
  }

  /**
   * Check if current token is an id token
   * @return {boolean} true or false indicating if token is an id token
   */
  public isIdToken(): boolean {
    try {
      const decoded = jwtDecode<CognitoIdentityTokenPayload>(this.token);
      if (decoded.token_use === 'id') {
        return true;
      }
      return false;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Check if current token is an access token
   * @return {boolean} true or false indicating if token is an access token
   */
  public isAccessToken(): boolean {
    try {
      const decoded = jwtDecode<CognitoAccessTokenPayload>(this.token);
      if (decoded.token_use === 'access') {
        return true;
      }
      return false;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Extract username from identity token 'cognito:username' field
   * @return {string} username present in token
   */
  private getUsernameFromIdToken(): string {
    try {
      const decoded = jwtDecode<CognitoIdentityTokenPayload>(this.token);
      const username = decoded['cognito:username'];
      if (!username) {
        return '';
      }
      return username;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Extract username from access token 'username' field
   * @return {string} username present in token
   */
  private getUsernameFromAccessToken(): string {
    try {
      const decoded = jwtDecode<CognitoAccessTokenPayload>(this.token);
      if (!decoded.username) {
        return '';
      }
      return decoded.username;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Convenience method that returns username claim present in either access
   * or identity token
   * @return {string} username present in token
   */
  public getUsernameClaim(): string {
    if (this.isAccessToken()) {
      return this.getUsernameFromAccessToken();
    }
    return this.getUsernameFromIdToken();
  }

  /**
   * Extract exp claim from identity token 'exp' field
   * @return {string} exp present in token
   */
   private getExpFromIdToken(): number {
    try {
      const decoded = jwtDecode<CognitoIdentityTokenPayload>(this.token);
      if (!decoded.exp) {
        return 0;
      }
      return decoded.exp;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Extract exp claim from access token 'exp' field
   * @return {string} exp present in token
   */
  private getExpFromAccessToken(): number {
    try {
      const decoded = jwtDecode<CognitoAccessTokenPayload>(this.token);
      if (!decoded.exp) {
        return 0;
      }
      return decoded.exp;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Convenience method that returns exp claim present in either access
   * or identity token
   * @return {string} exp present in token
   */
   public getExpClaim(): number {
    if (this.isAccessToken()) {
      return this.getExpFromAccessToken();
    }
    return this.getExpFromIdToken();
  }

  /**
   * Extract scope from identity token 'scope' field
   * @return {string} scope present in token
   */
   private getScopeFromIdToken(): string {
    try {
      const decoded = jwtDecode<CognitoIdentityTokenPayload>(this.token);
      if (!decoded.scope) {
        return '';
      }
      return decoded.scope;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Extract scope from access token 'scope' field
   * @return {string} username present in token
   */
  private getScopeFromAccessToken(): string {
    try {
      const decoded = jwtDecode<CognitoAccessTokenPayload>(this.token);
      if (!decoded.scope) {
        return '';
      }
      return decoded.scope;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Convenience method that returns scope claim present in either access
   * or identity token
   * @return {string} scope present in token
   */
   public getScopeClaim(): string {
    if (this.isAccessToken()) {
      return this.getScopeFromAccessToken();
    }
    return this.getScopeFromIdToken();
  }

  /**
   * Extract step_up claim from identity token
   * @return {string} value of claim present in id token. If claim is missing, return empty string
   */
  public getStepUpClaim(): string {
    try {
      const decoded = jwtDecode<CognitoIdentityTokenPayload>(this.token);
      if (!decoded.step_up) {
        return '';
      }
      return decoded.step_up;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Extract request_id claim from identity token
   * @return {string} value of claim present in id token. If claim is missing, return empty string
   */
  public getRequestIdClaim(): string {
    try {
      const decoded = jwtDecode<CognitoIdentityTokenPayload>(this.token);
      if (!decoded.request_id) {
        return '';
      }
      return decoded.request_id;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Extract client_id claim from identity token 'client_id' field
   * Note that identity token does not contain a client_id claim.
   * Instead the client id is value is stored in 'aud' claim of
   * identity token.
   * @return {string} client_id present in token
   */
   private getClientIdClaimFromIdToken(): string {
    try {
      const decoded = jwtDecode<CognitoIdentityTokenPayload>(this.token);
      if (!decoded.aud) {
        return '';
      }
      return decoded.aud;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Extract client_id from access token 'client_id' field
   * @return {string} client_id present in token
   */
  private getClientIdClaimFromAccessToken(): string {
    try {
      const decoded = jwtDecode<CognitoAccessTokenPayload>(this.token);
      if (!decoded.client_id) {
        return '';
      }
      return decoded.client_id;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Convenience method that returns 'client_id' claim present in either access
   * or identity token.  Note that Cognito's identity token does not contain the
   * client_id claim.
   * @return {string} client_id present in token
   */
  public getClientIdClaim(): string {
    if (this.isAccessToken()) {
      return this.getClientIdClaimFromAccessToken();
    }
    return this.getClientIdClaimFromIdToken();
  }

  /**
   * Extract jti claim from identity token 'jti' field
   * Note that if identity token does not contain a jti claim,
   * then we generate a unique one-way hash for the entire id token
   * @return {string} jti present in token
   */
  private getJtiClaimFromIdToken(): string {
    try {
      const decoded = jwtDecode<CognitoIdentityTokenPayload>(this.token);
      if (!decoded.jti) {
        // if jti claim doesn't exist then generate a unique one-way hash
        return crypto.createHash('sha1').update(JSON.stringify(decoded)).digest('hex');
      }
      return decoded.jti;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Extract jti from access token 'jti' field
   * Note that if identity token does not contain a jti claim,
   * then we generate a unique one-way hash for the entire id token
   * @return {string} jti present in token
   */
  private getJtiClaimFromAccessToken(): string {
    try {
      const decoded = jwtDecode<CognitoAccessTokenPayload>(this.token);
      if (!decoded.jti) {
        // if jti claim doesn't exist then generate a unique one-way hash
        return crypto.createHash('sha1').update(JSON.stringify(decoded)).digest('hex');
      }
      return decoded.jti;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Convenience method that returns unique identifier claim present in either access
   * or identity token.  Note that Cognito's identity token may not contain the
   * jti claim.
   * @return {string} jti present in token
   */
   public getJtiClaim(): string {
    if (this.isAccessToken()) {
      return this.getJtiClaimFromAccessToken();
    }
    return this.getJtiClaimFromIdToken();
  }

  /**
   * Extract the `sub` (subject) claim.  This is Cognito's immutable unique user id and is present on
   * both access and id tokens.  Used to bind an access token and an id token to the same user.
   * @return {string} sub claim, or empty string when absent
   */
  public getSubClaim(): string {
    try {
      const decoded = jwtDecode<JwtPayload>(this.token);
      return decoded.sub || '';
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Extract the `auth_time` claim: the epoch-seconds time of the end-user authentication event.
   * Cognito preserves `auth_time` across a token refresh, so a refreshed token keeps the original
   * authentication time; only a fresh sign-in advances it.  This property is what lets step-up
   * require a recent re-authentication that a stolen (or merely refreshed) token cannot satisfy.
   * @return {number} auth_time in epoch seconds, or 0 when absent
   */
  public getAuthTimeClaim(): number {
    try {
      const decoded = jwtDecode<JwtPayload & { auth_time?: number }>(this.token);
      return decoded.auth_time || 0;
    } catch ( e ) {
      throw new Error('invalid token');
    }
  }

  /**
   * Verify current token with aws-jwt-verify: signature (user pool JWKS), `exp`, `iss`
   * (derived from the user pool id), `token_use` and client id (`client_id` claim of an
   * access token, `aud` claim of an id token).
   * Fails closed: returns false when the user pool arn or client id is not configured,
   * when the token cannot be decoded, or when any verification check fails.
   * The token value is never logged.
   * @param {CognitoTokenUse} expectedTokenUse expected `token_use` claim.  Defaults to 'access'
   *   when the token is an access token, otherwise 'id'
   * @returns {boolean} true or false indicating if token verification was successful
   */
  public async verify(expectedTokenUse?: CognitoTokenUse): Promise<boolean> {
    if (!this.userPoolArn) {
      log.error('unable to verify token: user pool arn is not set.  Initialize CognitoToken class properly or set COGNITO_USER_POOL_ARN environment variable');
      return false;
    }
    if (!this.clientId) {
      log.error('unable to verify token: client id is not set.  Initialize CognitoToken class properly or set COGNITO_CLIENT_ID environment variable');
      return false;
    }

    try {
      const tokenUse: CognitoTokenUse = expectedTokenUse || (this.isAccessToken() ? 'access' : 'id');
      // extract cognito user-pool-id from the user pool arn
      const userPoolId = this.userPoolArn.substring(this.userPoolArn.lastIndexOf('/') + 1);
      const verifier = CognitoToken.getVerifier(userPoolId, tokenUse, this.clientId);
      await verifier.verify(this.token);
      // token verification successful, return true
      return true;
    }
    catch ( e ) {
      const err = e as Error;
      log.error(`error occurred while verifying token - ${err?.name}: ${err?.message}`);
    }

    // error occurred during token verification, return false
    return false;
  }
}

export { CognitoToken };
