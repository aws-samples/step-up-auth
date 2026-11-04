# Auth SDK

## Local Development Environment Setup

Complete steps below to setup local development environment.  VSCode IDE is recommended but not required.  If using VSCode, refer to .vscode folder for helper tasks (tasks.json), launch configuration (launch.json).

- link `auth-utils` first: run `npm ci && npm link` in the `auth-utils` folder
- run `npm ci` to download all node dependencies
- run `npm link` to create auth-sdk symbolic link in your global node_modules folder (run `npm root -g` to see where it is).  This allows other modules to import this module during local development by referencing `@step-up-auth/auth-sdk`
- run `npm link @step-up-auth/auth-utils` to use the local auth-utils module.  `npm ci` removes npm links, so run this step again after every `npm ci`
- run `npm run test` to execute unit tests.  The unit tests don't call AWS, so they don't need AWS credentials or `AWS_PROFILE`.
- run `npm run test-e2e` to execute end-to-end integration tests.  These tests require access to DynamoDB tables therefore these tests shouldn't execute in CICD pipeline.  Run these tests in local development mode, for now.
  - ensure that AWS credentials are available, for example by setting the AWS_PROFILE environment variable.  The tests use the deployed tables `step-up-auth-session-<ENV_PREFIX>`, `step-up-auth-setting-<ENV_PREFIX>` and `step-up-auth-token-<ENV_PREFIX>` (without the `-<ENV_PREFIX>` suffix when `ENV_PREFIX` is not set) in `AWS_REGION` (default `us-east-1`).

## DynamoDB Table Setup

### Session Table Structure

Table structure is outlined in `lib/dynamodb/model/Session.ts`.  The CDK deployment creates the tables (`deployment/lib/infrastructure/dynamodb-stack.ts`).  Following CloudFormation template highlights `session` table definition:

```yaml
  SessionDynamoDBTable:
    Type: "AWS::DynamoDB::Table"
    Properties:
      TableName: !Sub step-up-auth-session-${ENVNAME}
      AttributeDefinitions:
        -
          AttributeName: "sessionId"
          AttributeType: "S"
      KeySchema:
        -
          AttributeName: "sessionId"
          KeyType: "HASH"
      TimeToLiveSpecification:
        AttributeName: "ttl"
        Enabled: true
      BillingMode: PAY_PER_REQUEST
```

DynamoDB TTL on `ttl` only deletes old items, and deletion is not immediate, so every consumer still checks `ttl` itself.  `SessionClient` writes two kinds of rows with different ttl rules:

- Access-token session rows (`STEP_UP_REQUIRED` / `STEP_UP_COMPLETED`, keyed by the access token's `jti`).  `createSessionWithParams` sets `ttl` to `min(now + SESSION_TABLE_ITEM_TTL, access token exp)` so a session never outlives its access token, and the authorizer rejects a session whose `ttl` has passed.
- One-time challenge rows (`challenge#<challengeId>`).  `createChallengeSession` sets `ttl` to `creation time + STEP_UP_CHALLENGE_TTL` from a single clock read and deliberately bypasses the `min(..., access token exp)` calculation, so `SESSION_TABLE_ITEM_TTL` never shortens a challenge.  Challenge expiry is enforced by the respond-to-challenge Lambda, which treats a challenge whose `ttl` has passed as absent, not by the authorizer.

Following Global Secondary Index (GSI) is required:

- index name: -

### Setting Table Structure

Table structure is outlined in `lib/dynamodb/model/Setting.ts`.  Following CloudFormation template highlights `setting` table definition:

```yaml
  RuleDynamoDBTable:
    Type: "AWS::DynamoDB::Table"
    Properties:
      TableName: !Sub step-up-auth-setting-${ENVNAME}
      AttributeDefinitions:
        -
          AttributeName: "id"
          AttributeType: "S"
      KeySchema:
        -
          AttributeName: "id"
          KeyType: "HASH"
      BillingMode: PAY_PER_REQUEST
```

### Token Table Structure

Table structure is outlined in `lib/dynamodb/model/Token.ts`.  Following CloudFormation template highlights `token` table definition:

```yaml
  TokenDynamoDBTable:
    Type: "AWS::DynamoDB::Table"
    Properties:
      TableName: !Sub step-up-auth-token-${ENVNAME}
      AttributeDefinitions:
        -
          AttributeName: "id"
          AttributeType: "S"
      KeySchema:
        -
          AttributeName: "id"
          KeyType: "HASH"
      TimeToLiveSpecification:
        AttributeName: "ttl"
        Enabled: true
      BillingMode: PAY_PER_REQUEST
```

## Step-up Authentication Design

Refer to [README](../README.md)

## References

- https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/dynamodb-example-table-read-write.html
- https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/#getting-started
- https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/modules/_aws_sdk_util_dynamodb.html
