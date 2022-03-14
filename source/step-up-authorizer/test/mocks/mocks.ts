// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  Context,
  APIGatewayTokenAuthorizerEvent,
  APIGatewayRequestAuthorizerEventHeaders,
  APIGatewayRequestAuthorizerEvent,
  APIGatewayRequestAuthorizerEventMultiValueHeaders,
  APIGatewayRequestAuthorizerEventPathParameters,
  APIGatewayRequestAuthorizerEventQueryStringParameters,
  APIGatewayRequestAuthorizerEventMultiValueQueryStringParameters,
  APIGatewayRequestAuthorizerEventStageVariables,
  APIGatewayEventRequestContextWithAuthorizer,
  PolicyDocument,
  Statement,
  APIGatewayAuthorizerWithContextResult,
  APIGatewayAuthorizerResultContext
} from 'aws-lambda';
import { Session, Setting, StepUpStatusEnum } from '@step-up-auth/auth-sdk';

const headers: APIGatewayRequestAuthorizerEventHeaders = <APIGatewayRequestAuthorizerEventHeaders>{
  'Accept': '*/*',
  'Accept-Encoding': 'gzip, deflate, br',
  'Authorization': 'Bearer sample-token',
  'Host': 'abcdef.execute-api.us-east-1.amazonaws.com',
  'User-Agent': 'my-user-agent',
  'X-Amzn-Trace-Id': 'Root=1-12345-12345abcdef',
  'X-Forwarded-For': '10.0.0.1',
  'X-Forwarded-Port': '443',
  'X-Forwarded-Proto': 'https'
};

const multiValueHeaders: APIGatewayRequestAuthorizerEventMultiValueHeaders = <APIGatewayRequestAuthorizerEventMultiValueHeaders>{
  'Accept': [
    '*/*'
  ],
  'Accept-Encoding': [
    'gzip, deflate, br'
  ],
  'Authorization': [
    'Bearer sample-access-token'
  ],
  'Host': [
    'abcdef.execute-api.us-east-1.amazonaws.com'
  ],
  'User-Agent': [
    'my-user-agent'
  ],
  'X-Amzn-Trace-Id': [
    'Root=1-12345-12345abcdef'
  ],
  'X-Forwarded-For': [
    '10.0.0.1'
  ],
  'X-Forwarded-Port': [
    '443'
  ],
  'X-Forwarded-Proto': [
    'https'
  ]
};

const pathParameters: APIGatewayRequestAuthorizerEventPathParameters = <APIGatewayRequestAuthorizerEventPathParameters>{};
const queryStringParameters: APIGatewayRequestAuthorizerEventQueryStringParameters = <APIGatewayRequestAuthorizerEventQueryStringParameters>{};
const multiValueQueryStringParameters: APIGatewayRequestAuthorizerEventMultiValueQueryStringParameters = <APIGatewayRequestAuthorizerEventMultiValueQueryStringParameters>{};
const stageVariables: APIGatewayRequestAuthorizerEventStageVariables = <APIGatewayRequestAuthorizerEventStageVariables>{};
const requestContext: APIGatewayEventRequestContextWithAuthorizer<undefined> = <APIGatewayEventRequestContextWithAuthorizer<undefined>>{
  'resourceId': '4cce1j',
  'resourcePath': '/info',
  'httpMethod': 'GET',
  'extendedRequestId': 'bwI24EVdIAMFxqA=',
  'requestTime': '06/Mar/2021:06:31:33 +0000',
  'path': '/dev/info',
  'accountId': '1234567890',
  'protocol': 'HTTP/1.1',
  'stage': 'dev',
  'domainPrefix': 'abcdef',
  'requestTimeEpoch': 1615012293594,
  'requestId': '12345-abcdef',
  'identity': {
     'cognitoIdentityPoolId': null,
     'accountId': null,
     'cognitoIdentityId': null,
     'caller': null,
     'sourceIp': '10.0.0.1',
     'principalOrgId': null,
     'accessKey': null,
     'cognitoAuthenticationType': null,
     'cognitoAuthenticationProvider': null,
     'userArn': null,
     'userAgent': 'PostmanRuntime/7.26.10',
     'user': null
  },
  'domainName': 'abcdef.execute-api.us-east-1.amazonaws.com',
  'apiId': 'abcdef'
};



export const requestAuthorizerEvent: APIGatewayRequestAuthorizerEvent = <APIGatewayRequestAuthorizerEvent>{
  type: 'REQUEST',
  methodArn: 'arn:aws:execute-api:us-east-1:AWS_ACCOUNT:abcdef/dev/GET/info',
  resource: '/info',
  path: '/info',
  httpMethod: 'GET',
  headers: headers,
  multiValueHeaders: multiValueHeaders,
  pathParameters: pathParameters,
  queryStringParameters: queryStringParameters,
  multiValueQueryStringParameters: multiValueQueryStringParameters,
  stageVariables: stageVariables,
  requestContext: requestContext
};

export const tokenAuthorizerEvent: APIGatewayTokenAuthorizerEvent = <APIGatewayTokenAuthorizerEvent> {
  type: 'TOKEN',
  authorizationToken: 'sample-token',
  methodArn: 'arn:aws:execute-api:us-east-1:AWS_ACCOUNT:abcdef/dev/GET/info'
};

export const authorizerContext: Context = <Context>{
  callbackWaitsForEmptyEventLoop: true,
  functionVersion: '$LATEST',
  functionName: 'step-up-auth-authorizer-lambda',
  memoryLimitInMB: '128',
  logGroupName: '/aws/lambda/step-up-auth-authorizer-lambda',
  logStreamName: '2021/03/06/[$LATEST]abcdef12345',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:1234567890:function:step-up-auth-authorizer-lambda',
  awsRequestId: '12345-abcdef'
};

// create sample requestContext for Lambda proxy
const authorizerLambdaContext1 = <APIGatewayAuthorizerResultContext> {
  'step_up': 'not_required',
  'request_id': ''
};

// create sample allow response
const allowPolicyDocument = <PolicyDocument>{
  Version: '2012-10-17',
  Statement: []
};
const allowStatement: Statement = <Statement>{
  Effect: 'Allow',
  Resource: 'arn:aws:execute-api:us-east-1:AWS_ACCOUNT:abcdef/dev/GET/info',
  Action: 'execute-api:Invoke'
};
allowPolicyDocument.Statement.push(allowStatement);
export const authorizerResultWithAlow = <APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext>>{
  policyDocument: allowPolicyDocument,
  context: authorizerLambdaContext1
};

// create sample deny response
const denyPolicyDocument = <PolicyDocument>{
  Version: '2012-10-17',
  Statement: []
};
const denyStatement: Statement = <Statement>{
  Effect: 'Deny',
  Resource: 'arn:aws:execute-api:us-east-1:AWS_ACCOUNT:abcdef/dev/GET/info',
  Action: 'execute-api:Invoke'
};
denyPolicyDocument.Statement.push(denyStatement);
export const authorizerResultWithDeny = <APIGatewayAuthorizerWithContextResult<APIGatewayAuthorizerResultContext>>{
  policyDocument: denyPolicyDocument,
  context: authorizerLambdaContext1
};


// sample session 1
const now = new Date();
export const session1: Session = <Session> {
  sessionId: 'session-id-1',
  userId: 'user-1',
  clientId: 'client-id-1',
  token: '',
  referrerUrl: '/dev/info',
  stepUpStatus: StepUpStatusEnum.STEP_UP_NOT_REQUIRED,
  createTimestamp: now.toISOString(),
  lastUpdateTimestamp: now.toISOString(),
  ttl: 12345
};

// sample session 2
export const session2: Session = <Session> {
  sessionId: 'session-id-2',
  userId: 'user-2',
  clientId: 'client-id-2',
  token: '',
  referrerUrl: '/dev/info',
  stepUpStatus: StepUpStatusEnum.STEP_UP_REQUIRED,
  createTimestamp: now.toISOString(),
  lastUpdateTimestamp: now.toISOString(),
  ttl: 12345
};


// sample setting 1
export const setting1: Setting = <Setting> {
  id: '/info',
  stepUpStatus: StepUpStatusEnum.STEP_UP_NOT_REQUIRED,
  createTimestamp: now.toISOString(),
  lastUpdateTimestamp: now.toISOString()
};

// sample setting 2
export const setting2: Setting = <Setting> {
  id: '/info',
  stepUpStatus: StepUpStatusEnum.STEP_UP_REQUIRED,
  createTimestamp: now.toISOString(),
  lastUpdateTimestamp: now.toISOString()
};
