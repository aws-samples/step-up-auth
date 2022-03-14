# Auth SDK

## Local Development Environment Setup

Complete steps below to setup local development environment.  VSCode IDE is recommended but not required.  If using VSCode, refer to .vscode folder for helper tasks (task.json), launch configuration (launch.json).

- run `npm install` to download all node dependencies
- run `npm link` to create auth-sdk symbolic link that points to your /usr/local/lib/node_module folder (global node_modules).  This allows other modules to import this module during local development by referencing `@step-up-auth/auth-sdk`
- type `npm link` to create auth-util symbolic link that points to your /usr/local/lib/node_module folder (global node_modules)
- run `npm run test` to execute unit tests
  - ensure that AWS_PROFILE environment variable is set.  Set AWS_PROFILE to `default`.
- run `npm run test-e2e` to execute end-to-end integration tests.  These tests require access to DynamoDB tables therefore these tests shouldn't execute in CICD pipeline.  Run these tests in local development mode, for now.
  - ensure that AWS_PROFILE environment variable is set.  Set AWS_PROFILE to `default`.

## DynamoDB Table Setup

### Session Table Structure

Table structure is outlined in `lib/dynamodb/session.ts`.  Following CloudFormation template highlights `session` table definition:

```yaml
  SessionDynamoDBTable:
    Type: "AWS::DynamoDB::Table"
    Properties:
      TableName: !Sub step-up-auth-${ENVNAME}-session
      AttributeDefinitions:
        -
          AttributeName: "sessionId"
          AttributeType: "S"
      KeySchema:
        -
          AttributeName: "sessionId"
          KeyType: "HASH"
      BillingMode: PAY_PER_REQUEST
```

Following Global Secondary Index (GSI) is required:

- index name: -

### Setting Table Structure

Table structure is outlined in `lib/dynamodb/setting.ts`.  Following CloudFormation template highlights `setting` table definition:

```yaml
  RuleDynamoDBTable:
    Type: "AWS::DynamoDB::Table"
    Properties:
      TableName: !Sub step-up-auth-${ENVNAME}-setting
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

Table structure is outlined in `lib/dynamodb/token.ts`.  Following CloudFormation template highlights `token` table definition:

```yaml
  TokenDynamoDBTable:
    Type: "AWS::DynamoDB::Table"
    Properties:
      TableName: !Sub step-up-auth-${ENVNAME}-token
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

## Step-up Authentication Design

Refer to [README](../README.md)

## References

- https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/dynamodb-example-table-read-write.html
- https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/#getting-started
- https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/modules/_aws_sdk_util_dynamodb.html
