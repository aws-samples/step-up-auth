// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as path from 'path';
import * as cdk from '@aws-cdk/core';
import * as apigateway from '@aws-cdk/aws-apigateway';
import * as lambda from '@aws-cdk/aws-lambda';
import { Asset } from '@aws-cdk/aws-s3-assets';
import * as cognito from '@aws-cdk/aws-cognito';
import * as iam from '@aws-cdk/aws-iam';
import { CfnOutput } from "@aws-cdk/core";

export interface ApiGatewayProps extends cdk.StackProps {
  readonly environmentPrefix?: string;
  readonly nodeEnvironment?: string;
  readonly stepUpInitiateFunc: lambda.Function;
  readonly stepUpChallengeFunc: lambda.Function;
  readonly stepUpSampleApiFunc: lambda.Function;
  readonly lambdaExecutionRole: iam.Role;
  readonly cognitoUserPool: cognito.UserPool;
  readonly cognitoIssuer: string;
  readonly apigatewayLambdaAuthorizerRole: iam.Role;
  readonly apigatewayExecutionRole: iam.Role;
}

export class ApiGatewayStack extends cdk.Stack {
  readonly api: apigateway.RestApi;
  public readonly apiUrl?: string;

  constructor(scope: cdk.Construct, id: string, props: ApiGatewayProps) {
    super(scope, id, props);

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
    // create file assets and upload to S3 as-is
    const stepUpAuthorizerAsset = new Asset(this, 'step-up-auth-authorizer-asset', {
      path: path.join(__dirname, '..', '..', '..', 'source', 'step-up-authorizer', 'build', 'compressed', 'step-up-auth-authorizer-lambda.zip')
    });
    // create the lambda function
    const stepUpAuthorizerFunc = new lambda.Function(this, 'step-up-auth-authorizer-lambda', {
      code: lambda.Code.fromBucket(stepUpAuthorizerAsset.bucket, stepUpAuthorizerAsset.s3ObjectKey),
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'src/index.handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: props.lambdaExecutionRole,
      environment: {
        COGNITO_ISSUER: props.cognitoIssuer,
        COGNITO_USER_POOL_ARN: props.cognitoUserPool.userPoolArn,
        ENV_PREFIX: props.environmentPrefix || '',
        NODE_ENV: props.nodeEnvironment || ''
      }
    });
    const requestAuthorizer = new apigateway.RequestAuthorizer(this, 'step-up-authorizer', {
      identitySources: [apigateway.IdentitySource.header('Authorization')],
      handler: stepUpAuthorizerFunc,
      assumeRole: props.apigatewayLambdaAuthorizerRole,
      resultsCacheTtl: cdk.Duration.seconds(0)
    });

    // ----------------------------------------
    //      step-up-auth api
    // ----------------------------------------
    this.api = new apigateway.RestApi(this, 'step-up-auth-api', {
      restApiName: "step-up-auth",
      description: "This API provides reference implementation step-up auth",
      deploy: false
    });

    // add default gateway responses
    this.getDefaultGatewayResponses(this.api);

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
        proxy: true,
        credentialsRole: props.apigatewayExecutionRole
      });
    info.addMethod("GET", infoIntegration, {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: requestAuthorizer,
      methodResponses: this.getDefaultMethodResponses()
    });

    // initiate-auth resource
    const initiateAuth = this.api.root.addResource('initiate-auth');
    initiateAuth.addCorsPreflight(this.getCorsOptions());
    const initiateAuthIntegration =
      new apigateway.LambdaIntegration(props.stepUpInitiateFunc, {
        proxy: true,
        credentialsRole: props.apigatewayExecutionRole
      });
    initiateAuth.addMethod("POST", initiateAuthIntegration, {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      methodResponses: this.getDefaultMethodResponses()
    });

    // respond-to-challenge resource
    const respondToChallenge = this.api.root.addResource('respond-to-challenge');
    respondToChallenge.addCorsPreflight(this.getCorsOptions());
    const respondToChallengeIntegration =
      new apigateway.LambdaIntegration(props.stepUpChallengeFunc, {
        proxy: true,
        credentialsRole: props.apigatewayExecutionRole
      });
    respondToChallenge.addMethod("POST", respondToChallengeIntegration, {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      methodResponses: this.getDefaultMethodResponses()
    });

    // transfer resource
    const transfer = this.api.root.addResource('transfer');
    transfer.addCorsPreflight(this.getCorsOptions());
    const transferIntegration =
      new apigateway.LambdaIntegration(props.stepUpSampleApiFunc, {
        proxy: true,
        credentialsRole: props.apigatewayExecutionRole
      });
    transfer.addMethod("POST", transferIntegration, {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: requestAuthorizer,
      methodResponses: this.getDefaultMethodResponses()
    });

    // ----------------------------------------
    //            Deployment
    // ----------------------------------------
    const devDeploy = new apigateway.Deployment(this, 'dev-deploy', {
      api: this.api,
    });
    const devStage = new apigateway.Stage(this, 'dev', {
      deployment: devDeploy,
      stageName: 'dev'
    });
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
