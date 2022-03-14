# Deployment

Use this project to build and deploy step-up-auth CDK stack.  The project uses TypeScript language with CDK support.

The `cdk.json` file tells the CDK Toolkit how to execute the application.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template

## Deployment steps

Set the required environment variables then run `deployment/build.sh` followed by `deployment/deploy.sh`

Required ENV variables:
AWS_REGION
AWS_ACCOUNT
AWS_PROFILE
NODE_ENV
ENV_PREFIX

Run build as follows:

```sh
cd deployment && ./build.sh
```

And run deployment script as follows:

```sh
export AWS_REGION=us-east-1
export AWS_ACCOUNT=<your account number>
export AWS_PROFILE=<valid profile in .aws/credentials that contains secret/access key to your account>
export NODE_ENV=development
export ENV_PREFIX=dev
cd deployment && ./deploy.sh
```

For further details, refer to project [README.md](../README.md)
