# Auth Utils

## Local Development Environment Setup

In order to use `@step-up-auth/auth-utils` during development and testing locally, perform following steps:

- open VSCode embedded terminal window and change to `auth-utils` directory
- type `npm ci && npm link` to install the dependencies and create auth-utils symbolic link in your global node_modules folder (run `npm root -g` to see where it is)
- change to `step-up-authorizer` and now install `@step-up-auth/auth-utils` using `npm ci && npm link @step-up-auth/auth-sdk @step-up-auth/auth-utils`.  Link all local libraries a project needs in one `npm link` command: each `npm link` call replaces the links made by the previous one, and `npm ci` removes them
- repeat these steps for any other project that requires `@step-up-auth/auth-utils` dependency

To use the logger from `@step-up-auth/auth-utils`, import the `Logger` class and create one logger per file, as the Lambda functions do.  In TypeScript:

```typescript
import * as path from 'path';
import { Logger } from '@step-up-auth/auth-utils';

const log = new Logger(path.basename(__filename));

// inside a Lambda handler
log.debug('event: ', JSON.stringify(Logger.sanitizeEvent(event)));
```

The log level comes from `lib/config/development.json` (`debug`) or `lib/config/production.json` (`warn`), picked by `NODE_ENV`.  At `debug` level the logger prints the environment, showing only the values of the sample's settings, of the Lambda runtime's non-secret variables and of node-config's settings such as `NODE_ENV` (the list is `LOGGED_ENV_KEYS` in `lib/Logger.ts`); every other variable, including `NODE_CONFIG` and the AWS credential variables, is shown as `<redacted>`.  In every log line, the values of the AWS credential variables are redacted and every JWT is replaced with a short summary.  `Logger.sanitizeEvent()` also masks the `Authorization` and `Identification` headers of an API Gateway event and the `authorizationToken` of a TOKEN authorizer event.

The library also exports `CognitoToken`, which verifies Cognito JWTs with [aws-jwt-verify](https://github.com/awslabs/aws-jwt-verify).  `verify()` reads the user pool and app client from the `COGNITO_USER_POOL_ARN` and `COGNITO_CLIENT_ID` environment variables (or constructor arguments) and returns `false` when either is missing or the token fails verification.
