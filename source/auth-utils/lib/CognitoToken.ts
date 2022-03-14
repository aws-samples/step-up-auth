// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import jwtDecode, { JwtPayload } from 'jwt-decode';
import * as jwt from 'jsonwebtoken';
import * as crypto from "crypto";
import jwkToPem from 'jwk-to-pem';
import axios from 'axios';
import { TokenException } from './exception/TokenException';
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

/**
 * Cognito Token management utility class
 */
class CognitoToken {
  private token: string;
  private tokenIssuer?: string;
  private userPoolArn?: string;
  private userPoolPublicKeys?: CognitoUserPoolKeys;

  /**
   * C-TOR
   * @param  {string} token value that represents a Bearer token
   */
  constructor(token: string, tokenIssuer?: string, userPoolArn?: string) {
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
    // if all fails, leave userPoolArn as 'undefined'.  We test it in getTokenKey method.
    if (tokenIssuer) {
      this.tokenIssuer = tokenIssuer;
    }
    else if (process.env.COGNITO_ISSUER) {
      this.tokenIssuer = process.env.COGNITO_ISSUER;
    }

    // default userPoolArn to constructor passed userPoolArn
    // otherwise, read userPoolArn from environment variable 'COGNITO_USER_POOL_ARN'
    // if all fails, leave userPoolArn as 'undefined'.  We test it in getTokenKey method.
    if (userPoolArn) {
      this.userPoolArn = userPoolArn;
    }
    else if (process.env.COGNITO_USER_POOL_ARN) {
      this.userPoolArn = process.env.COGNITO_USER_POOL_ARN;
    }
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
   * Get the key used to sign the current token
   * @param {string} tokenIssuer cognito token issuer url.  It usually takes the form 'https://cognito-idp.AWS_REGION.amazonaws.com/us-east-N_XXXX'
   * @param {string} userPoolArn cognito user pool arn.
   * @returns {string} public key used to sign this.token
   */
  public async getTokenKey(tokenIssuer?: string, userPoolArn?: string): Promise<string> {

    // override tokenIssuer and userPoolArn values if we were invoked with parameters
    if (tokenIssuer) {
      this.tokenIssuer = tokenIssuer;
    }
    if (userPoolArn) {
      this.userPoolArn = userPoolArn;
    }

    // throw error if tokenIssuer is undefined
    if (!this.tokenIssuer) {
      const errorMessage = 'invalid cognitoIssuer.  Initialize CognitoToken class properly or set cognitoIssuer environment variable';
      log.error(errorMessage);
      throw new TokenException(errorMessage);
    }

    // throw error if userPoolArn is undefined
    if (!this.userPoolArn) {
      const errorMessage = 'invalid userPoolArn.  Initialize CognitoToken class properly or set userPoolArn environment variable';
      log.error(errorMessage);
      throw new TokenException(errorMessage);
    }

    const tokenSections = (this.getToken() || '').split('.');
    if (tokenSections.length < 2) {
      const errorMessage = `token is invalid.  tokenSections: ${tokenSections}`;
      log.error(errorMessage);
      throw new TokenException(errorMessage);
    }

    const headerJSON = Buffer.from(tokenSections[0], 'base64').toString('utf8');
    const header = JSON.parse(headerJSON);
    log.debug(`parsed token header: ${JSON.stringify(header)}`);

    // retrieve public keys of cognito user-pool
    const keys = await this.getUserPoolPublicKeys();
    // if the call above failed, throw an error
    if (!keys) {
      const errorMessage = 'unable to retrieve  Initialize CognitoToken class properly or set userPoolArn environment variable';
      log.error(errorMessage);
      throw new TokenException(errorMessage);
    }

    const key = keys[header.kid];

    // if key is not found in cognito user-pool public keys then throw error
    if (key === undefined) {
      const errorMessage = 'token was signed using unknown kid';
      log.error(errorMessage);
      throw new TokenException(errorMessage);
    }

    log.debug(`retrieved public key for kid ${header.kid}. returning pem ${key.pem}`);
    // otherwise, we managed to retrieve a key, let's return the pem value of key
    return key.pem;
  }

  /**
   * Invoke .well-known/jwks.json of currently set cognito user-pool (tokenIssuer) and
   * retrieve all keys used to sign tokens.
   * @returns {CognitoUserPoolKeys | undefined} return list of keys or undefined if error occurred while retrieving cognito user-pool public keys.
   */
  private async getUserPoolPublicKeys(): Promise<CognitoUserPoolKeys | undefined> {
    // throw error if userPoolArn is undefined
    if (!this.userPoolArn) {
      throw new TokenException('invalid userPoolArn.  Initialize CognitoToken class properly or set userPoolArn environment variable');
    }

    // extract cognito user-pool-id
    const userPoolId = this.userPoolArn.substring(this.userPoolArn.lastIndexOf("/") + 1);

    // if cognito public keys are not cached, make API call to retrieve keys
    // from .well-known/jwks.json endpoint of the cognito user pool
    if (!this.userPoolPublicKeys) {
      const url = `${this.tokenIssuer}/${userPoolId}/.well-known/jwks.json`;
      log.debug("public key url: " + url);
      const publicKeys = await axios.get(url);
      this.userPoolPublicKeys = publicKeys.data.keys.reduce( (accumulator: CognitoUserPoolKeys, currentValue: CognitoUserPoolKeyInstance) => {
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
      return this.userPoolPublicKeys;
    } else {
      return this.userPoolPublicKeys;
    }
  }

  /**
   * Verify current token
   * @returns {boolean} true or false indicating if token verification using token key was successful
   */
  public async verify(): Promise<boolean> {
    try {
      const tokenPublicKey = await this.getTokenKey();
      jwt.verify(this.token, tokenPublicKey);
      // token verification successful, return true
      return true;
    }
    catch ( e: any ) {
      if (e instanceof TokenException ) {
        const errorMessage = `error while retrieving key for token.  name: ${e.name} , message: ${e.message}`;
        log.error(errorMessage);
      } else {
        let errorMessage = `error occurred while verifying token`;
        if (e.message) {
          errorMessage = `error occurred while verifying token: ${e.message}`;
        }
        log.error(errorMessage);
      }
    }

    // error occurred during token verification, return false
    return false;
  }
}

export { CognitoToken };
