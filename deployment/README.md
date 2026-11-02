# Deployment

Use this project to build and deploy step-up-auth CDK stack.  The project uses TypeScript language with CDK v2 (`aws-cdk-lib`).

The `cdk.json` file tells the CDK Toolkit how to execute the application.

Prerequisites: Node.js 24 and npm 11 (the Lambda functions run on `nodejs24.x`), and the AWS CLI.  The CDK CLI is a dev dependency of this project, so run `npm ci` first and use `npx cdk` or `./node_modules/.bin/cdk`.

## Useful commands

* `npm ci`          install the locked dependencies
* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run lint`    run ESLint
* `npm run test`    perform the jest unit tests
* `npx cdk synth`   emits the synthesized CloudFormation templates (needs the Lambda zips from `./build.sh`)
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk deploy --all`  deploy all 7 stacks to the account and region set below (`./deploy.sh` also bootstraps the account and uploads the web app)

The app reads these context values: `aws_account`, `aws_region`, `env_prefix`, `node_env` and the optional `session_table_item_ttl` (seconds, default 900).  The `AWS_ACCOUNT`, `AWS_REGION` and `NODE_ENV` environment variables, when set, take precedence over `aws_account`, `aws_region` and `node_env`.  For example, to synthesize without deploying:

```sh
npx cdk synth -c aws_region=us-east-1 -c aws_account=123456789012 -c env_prefix=dev -c node_env=development
```

## Deployment steps

Set the required environment variables then run `deployment/build.sh` followed by `deployment/deploy.sh`

Required ENV variables:
AWS_REGION
AWS_ACCOUNT
AWS_PROFILE
NODE_ENV
ENV_PREFIX

Optional ENV variables:
SESSION_TABLE_ITEM_TTL (step-up session lifetime in seconds, default 900; set on the authorizer and respond-to-challenge Lambda functions)
CDK_TAGS (space-separated `key=value` pairs, passed as `--tags` to `cdk bootstrap` and `cdk deploy`)
CDK_OUTPUTS_FILE (file that keeps the stack outputs after `deploy.sh` exits)

Run build as follows.  `build.sh` runs `npm ci` in every project and packages the four Lambda zips:

```sh
cd deployment && npm ci && ./build.sh
```

And run deployment script as follows.  `deploy.sh` bootstraps the account for CDK v2 (`cdk bootstrap`), deploys all stacks, then builds and uploads the web app:

```sh
export AWS_REGION=us-east-1
export AWS_ACCOUNT=<your account number>
export AWS_PROFILE=<valid profile in .aws/credentials that contains secret/access key to your account>
export NODE_ENV=development
export ENV_PREFIX=dev
# optional
export SESSION_TABLE_ITEM_TTL=900
export CDK_TAGS="project=step-up-auth"
export CDK_OUTPUTS_FILE=$PWD/cdk-outputs.json
cd deployment && ./deploy.sh
```

To remove the solution, run `undeploy.sh` with the same variables.  It runs `cdk destroy --all --force` (CDK synthesizes the app first, so the Lambda zips from `build.sh` must still be present), which also deletes the Cognito user pool, the DynamoDB tables and the web bucket with its objects.  The CDK bootstrap stack (`CDKToolkit`) is not removed.

```sh
cd deployment && ./undeploy.sh
```

The Lambda CloudWatch log groups are not removed either.  `cdk.json` sets `@aws-cdk/aws-lambda:useCdkManagedLogGroup` to `true`, so CDK creates a log group for each of the four Lambda functions with a `RETAIN` removal policy, and `cdk destroy` keeps them.  The helper function that empties the web bucket also leaves its log group behind.  Their names start with `/aws/lambda/StepUpAuth`, as do the log groups of an earlier version of this sample in the same account and region.  List them, check the list, then delete them (this permanently deletes their log events):

```sh
aws logs describe-log-groups --region "$AWS_REGION" --log-group-name-prefix /aws/lambda/StepUpAuth \
  --query 'logGroups[].logGroupName' --output text
for group in $(aws logs describe-log-groups --region "$AWS_REGION" --log-group-name-prefix /aws/lambda/StepUpAuth \
    --query 'logGroups[].logGroupName' --output text); do
  aws logs delete-log-group --region "$AWS_REGION" --log-group-name "$group"
done
```

With `NODE_ENV=development` the Lambda functions write debug logs; credential environment values and JWTs are redacted.  `LOG_RAW_SECRETS=true` turns redaction off for local runs only, never inside Lambda.

To run the web app locally on http://127.0.0.1:8080 against the deployed backend:

```sh
cd source/sample-web-app && npm ci
npm start -- --env USER_POOL_ID=<UserPoolId> --env CLIENT_ID=<UserPoolClientId> \
  --env API_GATEWAY_API_NAME=step-up-auth --env API_GATEWAY_API_ENDPOINT=<StageUrl> --env AWS_REGION=us-east-1
```

For further details, refer to project [README.md](../README.md)
