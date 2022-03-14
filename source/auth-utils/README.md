# Auth Utils

## Local Development Environment Setup

In order to use `@step-up-auth/auth-sdk` during development and testing locally, perform following steps:

- open VSCode embedded terminal window and change to `auth-utils` directory
- type `npm link` to create auth-util symbolic link that points to your /usr/local/lib/node_module folder (global node_modules)
- change to `step-up-authorizer` and now install `@step-up-auth/auth-utils` using `npm link @step-up-auth/auth-utils`
- repeat these steps for any other project that requires `@step-up-auth/auth-utils` dependency

To import logger from `@step-up-auth/auth-utils` use the following require statement in ES6.

```javascript
const logger = require('@step-up-auth/auth-utils').logger;
```

In TypeScript:

```javascript
import { logger } from '@step-up-auth/auth-utils';
```

Read [Typescript Node Starter](https://github.com/microsoft/TypeScript-Node-Starter) guidelines by Microsoft on how to develop NodeJS modules in TypeScript.
