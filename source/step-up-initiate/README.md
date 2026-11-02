# API Gateway API (sample)

## Development Setup

- link the `auth-utils` and `auth-sdk` libraries first, as described in the root [README](../../README.md#deployment)
- run `npm ci && npm link @step-up-auth/auth-sdk @step-up-auth/auth-utils` to download all node dependencies and link both libraries.  Use this single command: each `npm link` call replaces the links made by the previous one, and `npm ci` removes them
- run `npm run test` to execute unit tests.  The unit tests don't call AWS, so they don't need AWS credentials or `AWS_PROFILE`.
