// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { createFunctionRole, LOG_RETENTION } from './function-role';

/** name of the only API stage */
const STAGE_NAME = 'dev';
/** stage-wide throttling: steady-state requests per second, and burst */
const THROTTLING_RATE_LIMIT = 10;
const THROTTLING_BURST_LIMIT = 20;
/** method request parameters: the Authorization header (access token) is required */
const AUTHORIZATION_HEADER_REQUIRED = { 'method.request.header.Authorization': true };

export interface ApiGatewayProps extends cdk.StackProps {
  readonly environmentPrefix?: string;
  readonly nodeEnvironment?: string;
  readonly stepUpInitiateFunc: lambda.Function;
  readonly stepUpChallengeFunc: lambda.Function;
  readonly stepUpSampleApiFunc: lambda.Function;
  /** step-up session lifetime in seconds (SESSION_TABLE_ITEM_TTL) */
  readonly sessionTableItemTtl: number;
  readonly cognitoUserPool: cognito.UserPool;
  readonly cognitoUserPoolClient: cognito.UserPoolClient;
  readonly cognitoIssuer: string;
  /** step-up session table, read and written by the authorizer */
  readonly sessionTable: dynamodb.ITable;
  /** api step-up setting table, read by the authorizer */
  readonly settingTable: dynamodb.ITable;
  /**
   * Root folder that holds the Lambda projects (<assetRoot>/<project>/build/compressed/*.zip).
   * @default path.join(__dirname, '..', '..', '..', 'source')
   */
  readonly assetRoot?: string;
}

export class ApiGatewayStack extends cdk.Stack {
  readonly api: apigateway.RestApi;
  public readonly apiUrl?: string;

  constructor(scope: Construct, id: string, props: ApiGatewayProps) {
    super(scope, id, props);

    const assetRoot = props.assetRoot || path.join(__dirname, '..', '..', '..', 'source');

    // ----------------------------------------
    //      cognito user pool authorizer
    // ----------------------------------------
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'cognito-authorizer', {
      identitySource: apigateway.IdentitySource.header('Identification'),
      cognitoUserPools: [props.cognitoUserPool]
    });

    // ----------------------------------------
    //  step-up-auth-authorizer request authorizer
    // ----------------------------------------
    // own role: write its log group, read the api setting (GetItem), and read and write the caller's
    // step-up session (GetItem, PutItem)
    const authorizer = createFunctionRole(this, 'step-up-auth-authorizer');
    authorizer.role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem'],
      resources: [props.settingTable.tableArn]
    }));
    authorizer.role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
      resources: [props.sessionTable.tableArn]
    }));
    // create file assets and upload to S3 as-is
    const stepUpAuthorizerAsset = new Asset(this, 'step-up-auth-authorizer-asset', {
      path: path.join(assetRoot, 'step-up-authorizer', 'build', 'compressed', 'step-up-auth-authorizer-lambda.zip')
    });
    // create the lambda function
    const stepUpAuthorizerFunc = new lambda.Function(this, 'step-up-auth-authorizer-lambda', {
      code: lambda.Code.fromBucket(stepUpAuthorizerAsset.bucket, stepUpAuthorizerAsset.s3ObjectKey),
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'src/index.handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: authorizer.role,
      logGroup: authorizer.logGroup,
      environment: {
        COGNITO_ISSUER: props.cognitoIssuer,
        COGNITO_USER_POOL_ARN: props.cognitoUserPool.userPoolArn,
        COGNITO_CLIENT_ID: props.cognitoUserPoolClient.userPoolClientId,
        SESSION_TABLE_ITEM_TTL: String(props.sessionTableItemTtl),
        ENV_PREFIX: props.environmentPrefix || '',
        NODE_ENV: props.nodeEnvironment || ''
      }
    });
    // no assumeRole: API Gateway invokes the authorizer through a Lambda permission that CDK scopes
    // (aws:SourceArn) to this authorizer of this API, so no IAM role trusts apigateway.amazonaws.com
    const requestAuthorizer = new apigateway.RequestAuthorizer(this, 'step-up-authorizer', {
      identitySources: [apigateway.IdentitySource.header('Authorization')],
      handler: stepUpAuthorizerFunc,
      resultsCacheTtl: cdk.Duration.seconds(0)
    });

    // ----------------------------------------
    //      step-up-auth api
    // ----------------------------------------
    // Regional endpoint with the SecurityPolicy_TLS13_1_2_2021_06 security policy (TLS 1.2 and 1.3 only;
    // a new regional REST API otherwise gets TLS_1_0, and API Gateway rejects the legacy TLS_1_2 policy
    // on a regional REST API).  An enhanced (SecurityPolicy_*) policy needs an endpoint access mode;
    // BASIC keeps API Gateway's standard request handling.  The RestApi construct doesn't expose these
    // properties, so they are set on the CloudFormation resource below.
    // cloudWatchRole stays false (cdk.json disables it by default): the stage's CloudWatch logging uses
    // the account's existing API Gateway CloudWatch Logs role, which is one setting per account and
    // region, so the sample doesn't create or replace it (deploy.sh checks that it is set).
    this.api = new apigateway.RestApi(this, 'step-up-auth-api', {
      restApiName: "step-up-auth",
      description: "This API provides reference implementation step-up auth",
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL]
      },
      cloudWatchRole: false,
      deploy: false
    });
    const cfnApi = this.api.node.defaultChild as apigateway.CfnRestApi;
    cfnApi.securityPolicy = 'SecurityPolicy_TLS13_1_2_2021_06';
    cfnApi.endpointAccessMode = 'BASIC';

    // request validation on every method (the CORS preflights aside):
    // - GET /info, POST /initiate-auth and POST /transfer take no body or parameters; they require the
    //   Authorization header that carries the access token
    // - POST /respond-to-challenge takes a JSON object whose optional challengeId is the 32-character
    //   hex id minted by /initiate-auth.  A body that isn't such an object is rejected with 400 before
    //   the function runs; a missing challengeId still reaches the function, which answers 401
    //   NO_CHALLENGE, and so does a missing Authorization header (401 UNAUTHENTICATED)
    const requestValidator = this.api.addRequestValidator('request-validator', {
      validateRequestBody: true,
      validateRequestParameters: true
    });
    const respondToChallengeModel = this.api.addModel('respond-to-challenge-model', {
      contentType: 'application/json',
      modelName: 'RespondToChallengeRequest',
      schema: {
        schema: apigateway.JsonSchemaVersion.DRAFT4,
        title: 'RespondToChallengeRequest',
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          challengeId: {
            type: apigateway.JsonSchemaType.STRING,
            pattern: '^[0-9a-f]{32}$'
          }
        }
      }
    });

    // add default gateway responses
    this.getDefaultGatewayResponses(this.api);

    // Every method runs behind an authorizer: the Lambda request authorizer (access token and step-up
    // session) for GET /info and POST /transfer, the Cognito user pool authorizer (ID token) for
    // POST /initiate-auth and POST /respond-to-challenge.  Only the CORS preflight OPTIONS methods
    // (addCorsPreflight) are unauthenticated, because browsers send preflights without credentials;
    // they use a mock integration that returns the CORS headers and invoke no function.
    // The Lambda integrations use no credentials role: API Gateway invokes each function through a
    // Lambda permission that CDK scopes (aws:SourceArn) to that method of this API.

    // info resource
    const info = this.api.root.addResource('info', {
      // defaultCorsPreflightOptions: {
      //   allowOrigins: apigateway.Cors.ALL_ORIGINS,
      //   allowMethods: apigateway.Cors.ALL_METHODS
      // }
    });
    info.addCorsPreflight(this.getCorsOptions());
    const infoIntegration =
      new apigateway.LambdaIntegration(props.stepUpSampleApiFunc, {
        proxy: true
      });
    info.addMethod("GET", infoIntegration, {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: requestAuthorizer,
      requestValidator: requestValidator,
      requestParameters: AUTHORIZATION_HEADER_REQUIRED,
      methodResponses: this.getDefaultMethodResponses()
    });

    // initiate-auth resource
    const initiateAuth = this.api.root.addResource('initiate-auth');
    initiateAuth.addCorsPreflight(this.getCorsOptions());
    const initiateAuthIntegration =
      new apigateway.LambdaIntegration(props.stepUpInitiateFunc, {
        proxy: true
      });
    initiateAuth.addMethod("POST", initiateAuthIntegration, {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      requestValidator: requestValidator,
      requestParameters: AUTHORIZATION_HEADER_REQUIRED,
      methodResponses: this.getDefaultMethodResponses()
    });

    // respond-to-challenge resource
    const respondToChallenge = this.api.root.addResource('respond-to-challenge');
    respondToChallenge.addCorsPreflight(this.getCorsOptions());
    const respondToChallengeIntegration =
      new apigateway.LambdaIntegration(props.stepUpChallengeFunc, {
        proxy: true
      });
    respondToChallenge.addMethod("POST", respondToChallengeIntegration, {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      requestValidator: requestValidator,
      requestModels: {
        'application/json': respondToChallengeModel
      },
      methodResponses: this.getDefaultMethodResponses()
    });

    // transfer resource
    const transfer = this.api.root.addResource('transfer');
    transfer.addCorsPreflight(this.getCorsOptions());
    const transferIntegration =
      new apigateway.LambdaIntegration(props.stepUpSampleApiFunc, {
        proxy: true
      });
    transfer.addMethod("POST", transferIntegration, {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: requestAuthorizer,
      requestValidator: requestValidator,
      requestParameters: AUTHORIZATION_HEADER_REQUIRED,
      methodResponses: this.getDefaultMethodResponses()
    });

    // ----------------------------------------
    //            Deployment
    // ----------------------------------------
    const devDeploy = new apigateway.Deployment(this, 'dev-deploy', {
      api: this.api,
    });
    // access log: one JSON line per request (no headers or bodies, so no tokens)
    const accessLogGroup = new logs.LogGroup(this, 'access-log-group', {
      retention: LOG_RETENTION,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    // execution log: API Gateway writes it to a log group with this fixed name.  Declaring the group
    // here gives it a retention and removes it with the stack (otherwise API Gateway creates it with
    // no expiry and it outlives the stack).
    const executionLogGroup = new logs.LogGroup(this, 'execution-log-group', {
      logGroupName: `API-Gateway-Execution-Logs_${this.api.restApiId}/${STAGE_NAME}`,
      retention: LOG_RETENTION,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    const devStage = new apigateway.Stage(this, 'dev', {
      deployment: devDeploy,
      stageName: STAGE_NAME,
      accessLogDestination: new apigateway.LogGroupLogDestination(accessLogGroup),
      accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
        caller: true,
        httpMethod: true,
        ip: true,
        protocol: true,
        requestTime: true,
        resourcePath: true,
        responseLength: true,
        status: true,
        user: true
      }),
      // execution logging for every method at ERROR level; data tracing (full requests and responses,
      // which would include the tokens) stays off
      loggingLevel: apigateway.MethodLoggingLevel.ERROR,
      dataTraceEnabled: false,
      // stage-wide throttling for every method
      throttlingRateLimit: THROTTLING_RATE_LIMIT,
      throttlingBurstLimit: THROTTLING_BURST_LIMIT
    });
    devStage.node.addDependency(executionLogGroup);
    this.apiUrl = devStage.urlForPath();

    // ----------------------------------------
    //           export values
    // ----------------------------------------
    new CfnOutput(this, "RestApiName", {
      value: this.api.restApiName,
    });
    new CfnOutput(this, "StageUrl", {
      value: this.apiUrl,
    });
  }

  private getCorsOptions(): apigateway.CorsOptions {
    return {
      allowOrigins: ['*'],
      allowMethods: [ 'GET', 'POST'],
      allowHeaders: [
        'Content-Type',
        'X-Amz-Date',
        'Authorization',
        'Identification',
        'X-Api-Key',
        'X-Amz-Security-Token'
      ]
    };
  }

  private getDefaultMethodResponses(): apigateway.MethodResponse[] {
    const response: apigateway.MethodResponse[] = [
      {
        // Successful response from the integration
        statusCode: '200',
        // Define what parameters are allowed or not
        responseParameters: {
          'method.response.header.Content-Type': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
          'method.response.header.Access-Control-Allow-Origin': true,
          // 'method.response.header.Access-Control-Allow-Credentials': false
        },
        // Validate the schema on the response
        responseModels: {
          'application/json': apigateway.Model.EMPTY_MODEL
        }
      },
      {
        // Same thing for the error responses
        statusCode: '400',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
          'method.response.header.Access-Control-Allow-Origin': true,
        }
      },
      {
        // Same thing for the error responses
        statusCode: '401',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.x-amzn-Remapped-WWW-Authenticate': true,
        }
      },
      {
        // Same thing for the error responses
        statusCode: '404',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
          'method.response.header.Access-Control-Allow-Origin': true,
        }
      }
    ];

    return response;
  }

  private getDefaultResponseHeader(): {[key: string]: string} {
    return {
      'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,Identification,X-Api-Key,X-Amz-Security-Token'",
      'Access-Control-Allow-Methods': "'OPTIONS,POST'",
      'Access-Control-Allow-Origin': "'*'"
    };
  }

  private getDefaultGatewayResponses(api: apigateway.RestApi) {
    api.addGatewayResponse('default-4xx', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: this.getDefaultResponseHeader()
    });

    api.addGatewayResponse('default-5xx', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: this.getDefaultResponseHeader()
    });

    // api.addGatewayResponse('access-denied', {
    //   type: apigateway.ResponseType.ACCESS_DENIED,
    //   statusCode: '403',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('api-configuration-error', {
    //   type: apigateway.ResponseType.API_CONFIGURATION_ERROR,
    //   statusCode: '500',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('authorizer-configuration-error', {
    //   type: apigateway.ResponseType.AUTHORIZER_CONFIGURATION_ERROR,
    //   statusCode: '500',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('authorizer-failure', {
    //   type: apigateway.ResponseType.AUTHORIZER_FAILURE,
    //   statusCode: '500',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('bad-request-body', {
    //   type: apigateway.ResponseType.BAD_REQUEST_BODY,
    //   statusCode: '400',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('bad-request-parameters', {
    //   type: apigateway.ResponseType.BAD_REQUEST_PARAMETERS,
    //   statusCode: '400',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('expired-token', {
    //   type: apigateway.ResponseType.EXPIRED_TOKEN,
    //   statusCode: '403',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('integration-failure', {
    //   type: apigateway.ResponseType.INTEGRATION_FAILURE,
    //   statusCode: '504',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('integration-timeout', {
    //   type: apigateway.ResponseType.INTEGRATION_TIMEOUT,
    //   statusCode: '504',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('invalid-api-key', {
    //   type: apigateway.ResponseType.INVALID_API_KEY,
    //   statusCode: '403',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('invalid-signature', {
    //   type: apigateway.ResponseType.INVALID_SIGNATURE,
    //   statusCode: '403',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('missing-authentication-token', {
    //   type: apigateway.ResponseType.MISSING_AUTHENTICATION_TOKEN,
    //   statusCode: '403',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('quota-exceeded', {
    //   type: apigateway.ResponseType.QUOTA_EXCEEDED,
    //   statusCode: '429',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('request-too-large', {
    //   type: apigateway.ResponseType.REQUEST_TOO_LARGE,
    //   statusCode: '413',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('resource-not-found', {
    //   type: apigateway.ResponseType.RESOURCE_NOT_FOUND,
    //   statusCode: '404',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('throttled', {
    //   type: apigateway.ResponseType.THROTTLED,
    //   statusCode: '429',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('unauthorized', {
    //   type: apigateway.ResponseType.UNAUTHORIZED,
    //   statusCode: '401',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('unsupported-media-type', {
    //   type: apigateway.ResponseType.UNSUPPORTED_MEDIA_TYPE,
    //   statusCode: '415',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });

    // api.addGatewayResponse('waf-filtered', {
    //   type: apigateway.ResponseType.WAF_FILTERED,
    //   statusCode: '403',
    //   responseHeaders: this.getDefaultResponseHeader()
    // });
  }

  // private addCorsOptionsToResponse(apiResource: apigateway.IResource) {
  //   apiResource.addMethod('OPTIONS', new apigateway.MockIntegration({
  //     integrationResponses: [{
  //       statusCode: '200',
  //       responseParameters: {
  //         'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
  //         'method.response.header.Access-Control-Allow-Origin': "'*'",
  //         'method.response.header.Access-Control-Allow-Credentials': "'false'",
  //         'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE'",
  //       },
  //     }],
  //     passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
  //     requestTemplates: {
  //       "application/json": "{\"statusCode\": 200}"
  //     },
  //   }), {
  //     methodResponses: [{
  //       statusCode: '200',
  //       responseParameters: {
  //         'method.response.header.Access-Control-Allow-Headers': true,
  //         'method.response.header.Access-Control-Allow-Methods': true,
  //         'method.response.header.Access-Control-Allow-Credentials': true,
  //         'method.response.header.Access-Control-Allow-Origin': true,
  //       },
  //     }]
  //   });
  // }
}
