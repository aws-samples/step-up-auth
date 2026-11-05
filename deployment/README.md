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

The app reads these context values: `aws_account`, `aws_region`, `env_prefix`, `node_env`, and the optional step-up tuning values `session_table_item_ttl` (default 900, range 60–900), `step_up_challenge_ttl` (default 600, range 60–900), `step_up_max_reauth_age` (default 120, range 30–900), `step_up_challenge_clock_skew` (default 1, range 0–10) and `step_up_reauth_future_skew` (default 5, range 0–10).  An out-of-range step-up value fails the deployment.  The user pool's MFA setting is not a context value: the CDK code fixes it at required, with the software token (authenticator app) as the only factor, and a unit test fails if that changes.  The `AWS_ACCOUNT`, `AWS_REGION` and `NODE_ENV` environment variables, when set, take precedence over `aws_account`, `aws_region` and `node_env`.  For example, to synthesize without deploying:

```sh
npx cdk synth -c aws_region=us-east-1 -c aws_account=123456789012 -c env_prefix=dev -c node_env=development
```

The Cognito stack creates the user pool, its web app client and a pre token generation Lambda trigger:

* the user pool requires MFA with the software token (authenticator app) as the only factor, requires the `email` and `phone_number` attributes, doesn't remember devices and uses the Essentials feature plan;
* the trigger (event version V2_0, inline code from `lib/infrastructure/pre-token-generation.ts`) removes the `aws.cognito.signin.user.admin` scope from every access token the pool issues.  It has its own role, which can only write the trigger's log group.

The Lambda stack gives the respond-to-challenge function the user pool id (`USER_POOL_ID`) and a policy that allows `cognito-idp:AdminGetUser` and `cognito-idp:GetUserPoolMfaConfig` on this user pool only.

## Deployment steps

Set the required environment variables then run `deployment/build.sh` followed by `deployment/deploy.sh`

Required ENV variables:
AWS_REGION
AWS_ACCOUNT
AWS_PROFILE
NODE_ENV
ENV_PREFIX

Optional ENV variables (each maps to the matching CDK context value above, with the same default and range):
SESSION_TABLE_ITEM_TTL (step-up session lifetime in seconds, default 900, range 60–900; set on the authorizer, respond-to-challenge and initiate Lambda functions)
STEP_UP_CHALLENGE_TTL (one-time challenge lifetime in seconds, default 600, range 60–900; initiate Lambda)
STEP_UP_MAX_REAUTH_AGE (maximum age of the accepted re-authentication in seconds, default 120, range 30–900; respond-to-challenge Lambda)
STEP_UP_CHALLENGE_CLOCK_SKEW (allowance for the "authenticated after the challenge" check in seconds, default 1, range 0–10; respond-to-challenge Lambda)
STEP_UP_REAUTH_FUTURE_SKEW (allowance for a future-dated auth_time in seconds, default 5, range 0–10; respond-to-challenge Lambda)
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

The Lambda CloudWatch log groups are not removed either.  `cdk.json` sets `@aws-cdk/aws-lambda:useCdkManagedLogGroup` to `true`, so CDK creates a log group for each of the four Lambda functions with a `RETAIN` removal policy, and `cdk destroy` keeps them.  The helper function that empties the web bucket also leaves its log group behind.  The pre token generation trigger's log group is the exception: it has a `DESTROY` removal policy, so `cdk destroy` deletes it.  The retained log groups' names start with `/aws/lambda/StepUpAuth`, as do the log groups of an earlier version of this sample in the same account and region.  List them, check the list, then delete them (this permanently deletes their log events):

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

## Deploying a function with the AWS CLI scripts

Each Lambda module under `source/` also has a `deploy-awscli.sh` script that creates or updates that one function against resources that already exist.  These scripts don't create the user pool.  If you use them instead of CDK, configure the user pool yourself the way the Cognito stack does:

* MFA required, with the software token (authenticator app) as the only factor, and no other MFA factor;
* the Essentials feature plan, and a pre token generation trigger with event version V2_0 that removes `aws.cognito.signin.user.admin` from every access token (the handler source is in `lib/infrastructure/pre-token-generation.ts`);
* `email` and `phone_number` required, and no remembered devices.

`source/step-up-challenge/deploy-awscli.sh` sets the function's `USER_POOL_ID` to the pool id at the end of `COGNITO_UP_ARN` and checks its shape.  Before it deploys, it reads the pool's MFA configuration (`aws cognito-idp get-user-pool-mfa-config`) and exits without deploying unless MFA is required with the software token only.  The role in `AWS_LAMBDA_ROLE_ARN` must allow `cognito-idp:AdminGetUser` and `cognito-idp:GetUserPoolMfaConfig` on that user pool, and the credentials that run the script need `cognito-idp:GetUserPoolMfaConfig` too.

For further details, refer to project [README.md](../README.md)
