// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as path from 'path';
import * as winston from 'winston';

// Set NODE_CONFIG_DIR before importing the node-config module.  Otherwise,
// config module will not be able to load the required configuration file.
// Additionally, override node-config configuration folder path when running
// in local or test modes.  In 'development' or 'production' mode, the config
// file is loaded from /lib/config
if (process.env.NODE_ENV === 'local' || process.env.NODE_ENV === 'test') {
  process.env.NODE_CONFIG_DIR = path.join(__dirname, '/../test/config');
} else {
  process.env.NODE_CONFIG_DIR = path.join(__dirname, 'config');
}
import config from 'config';
import { jwtDecode } from 'jwt-decode';

// environment variables that hold AWS credentials.  Their values are always redacted, in every log line
const AWS_CREDENTIAL_ENV_KEYS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];
// environment variables whose values the debug log shows: the sample's own settings and the Lambda
// runtime's non-secret variables.  Every other variable is shown as <redacted>, whatever its name, so a
// secret that is added later under any name never reaches the log
const LOGGED_ENV_KEYS = [
  'COGNITO_ISSUER', 'COGNITO_USER_POOL_ARN', 'COGNITO_CLIENT_ID', 'USER_POOL_ID', 'ENV_PREFIX',
  'SESSION_TABLE_ITEM_TTL', 'SESSION_ID_EXP_TIMEOUT', 'STEP_UP_CHALLENGE_TTL', 'STEP_UP_MAX_REAUTH_AGE',
  'STEP_UP_CHALLENGE_CLOCK_SKEW', 'STEP_UP_REAUTH_FUTURE_SKEW',
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_EXECUTION_ENV', 'AWS_LAMBDA_FUNCTION_NAME',
  'AWS_LAMBDA_FUNCTION_VERSION', 'AWS_LAMBDA_FUNCTION_MEMORY_SIZE', 'AWS_LAMBDA_LOG_GROUP_NAME',
  'AWS_LAMBDA_LOG_STREAM_NAME', 'AWS_LAMBDA_INITIALIZATION_TYPE', 'LAMBDA_TASK_ROOT', 'LAMBDA_RUNTIME_DIR',
  '_HANDLER', 'TZ', 'LANG', 'PATH', 'LD_LIBRARY_PATH',
  'NODE_ENV', 'NODE_CONFIG_ENV', 'NODE_CONFIG_DIR', 'NODE_APP_INSTANCE', 'ALLOW_CONFIG_MUTATIONS',
  'SUPPRESS_NO_CONFIG_WARNING'
];
// node-config variables that the constructor logs first, in this order (describeEnvironment() leaves them out)
const NODE_CONFIG_ENV_KEYS = [
  'NODE_ENV', 'NODE_CONFIG_ENV', 'NODE_CONFIG_DIR', 'NODE_CONFIG', 'NODE_APP_INSTANCE', 'NODE_CONFIG_PARSER',
  'ALLOW_CONFIG_MUTATIONS', 'SUPPRESS_NO_CONFIG_WARNING'
];
// request headers whose values are masked by sanitizeEvent(): the sample's token headers and the
// standard credential headers
const SENSITIVE_HEADER_PATTERN =
  /^(authorization|identification|proxy-authorization|cookie|set-cookie|x-api-key|x-amz-security-token)$/i;
// authorizer claims that sanitizeEvent() keeps (identifiers and token metadata, no personal data).
// Everything else in requestContext.authorizer.claims (e.g. email, phone_number) is dropped
const AUTHORIZER_CLAIMS_KEPT = ['sub', 'cognito:username', 'token_use', 'aud', 'iss', 'exp', 'iat', 'auth_time'];
// a signed JWT (header.payload.signature) anywhere in a string
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g;
// a string that is exactly one JWT
const SINGLE_JWT_PATTERN = /^eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*$/;
// JWT header fields and claims that summarizeJwt() keeps.  Everything else (e.g. email, phone) is dropped
const JWT_SUMMARY_HEADER_FIELDS = ['kid', 'alg'];
const JWT_SUMMARY_CLAIMS = ['sub', 'username', 'cognito:username', 'jti', 'exp', 'iat', 'token_use', 'scope', 'client_id', 'aud'];
const JWT_PREFIX_LENGTH = 12;
const REDACTED = '<redacted>';
const MASKED = '<masked>';

/**
 * Configurable log class that is built on top of winston and node-config modules.
 * Refer to:
 *   https://github.com/winstonjs/winston
 *   https://github.com/lorenwest/node-config
 *
 * Logger's configuration is stored in JSON file under config/ folder.  During
 * initialization, Logger checks NODE_ENV environment variable and automatically
 * picks the correct configuration file.  File name is determined by the value
 * of NODE_ENV.  Possible values of NODE_ENV are 'production', 'development',
 * 'test' or 'local'.  The last two values loads the same `test.json` file.
 */
class Logger {
  private logger: winston.Logger;
  private fileName: string; // logger module/file name

  /**
   * C-TOR
   * @param {string} filename name of file where the log message originates from
   */
  constructor(filename: string) {
    this.fileName = filename;

    // remove default Console transport, we will add new one below
    winston.remove(winston.transports.Console);

    const customFormat = winston.format.printf((i: { level: string, message: unknown; timestamp?: unknown}) => {
      const logText = `${JSON.stringify(i.message)}`;
      if (config.get('logging.show_timestamp')) {
        return `${i.timestamp} [${i.level}] ${logText}`;
      }
      return `[${i.level}] ${logText}`;
    });

    const { combine, timestamp, colorize, splat } = winston.format;


    // create a formatFunction based on configuration values
    let formatFunction = combine(splat(), customFormat);
    if (config.get('logging.colorize_console') && config.get('logging.show_timestamp')) {
      formatFunction = combine(colorize(), timestamp(), splat(), customFormat);
    } else if (!config.get('logging.colorize_console') && config.get('logging.show_timestamp')) {
      formatFunction = combine(timestamp(), splat(), customFormat);
    } else if (config.get('logging.colorize_console') && !config.get('logging.show_timestamp')) {
      formatFunction = combine(colorize(), splat(), customFormat);
    } else if (!config.get('logging.colorize_console') && !config.get('logging.show_timestamp')) {
      formatFunction = combine(splat(), customFormat);
    }

    // console transports options
    const consoleTransportOptions = {
      handleExceptions: true
    };
    // create transports with a console transport with options
    const transports = [
      new winston.transports.Console(consoleTransportOptions)
    ];

    // finally let's create the winston logger with format function, and transports
    this.logger = winston.createLogger({
      level: config.get('logging.level'),
      format: formatFunction,
      transports: transports,
      exitOnError: false
    });

    // display some runtime configuration information.  These values go through the same redaction as
    // every other variable: NODE_CONFIG and NODE_CONFIG_PARSER can carry a whole configuration, so they
    // are not in LOGGED_ENV_KEYS and are shown as <redacted> when set
    this.logger.debug('Node Environment:');
    NODE_CONFIG_ENV_KEYS.forEach((key) => {
      this.logger.debug(Logger.redactText(`${key}: ${Logger.redactEnvValue(key, process.env[key])}`));
    });

    // display remaining environment variables (only the values of known non-secret variables are shown)
    const environment = Logger.describeEnvironment(process.env);
    Object.keys(environment).forEach((key) => {
      this.logger.debug(Logger.redactText(`${key}: ${environment[key]}`));
    });

    // display logger settings retrieved from config file
    this.logger.debug(`log level: ${config.get('logging.level')}`);
    this.logger.debug(`log colorize: ${config.get('logging.colorize_console')}`);
    this.logger.debug(`log show timestamp: ${config.get('logging.show_timestamp')}`);
    this.logger.debug(`log show timestamp: ${config.get('logging.show_timestamp')}`);
  }

  /**
   * Private method that uses winston logger to log message using `info` level
   * @param {string} fileName name of file where the log message originates from
   * @param {string} text log message
   * @param {unknown} args an arbitrary number of arguments that are converted to strings and logged with the `text`
   */
  private logInfo(fileName: string, text: string, args?: unknown): void {
    if (typeof fileName === "undefined" || !fileName) {
      args ?
        this.logger.info(Logger.redactText(`${text}${args}`)) :
        this.logger.info(Logger.redactText(`${text}`));
    } else {
      args ?
        this.logger.info(Logger.redactText(`${fileName}: ${text}${args}`)) :
        this.logger.info(Logger.redactText(`${fileName}: ${text}`));
    }
  }

  /**
   * Private method that uses winston logger to log message using `debug` level
   * @param {string} fileName name of file where the log message originates from
   * @param {string} text log message
   * @param {unknown} args an arbitrary number of arguments that are converted to strings and logged with the `text`
   */
  private logDebug(fileName: string, text: string, args?: unknown): void {
    if (typeof fileName === "undefined" || !fileName) {
      args ?
        this.logger.debug(Logger.redactText(`${text}${args}`)) :
        this.logger.debug(Logger.redactText(`${text}`));
    } else {
      args ?
        this.logger.debug(Logger.redactText(`${fileName}: ${text}${args}`)) :
        this.logger.debug(Logger.redactText(`${fileName}: ${text}`));
    }
  }

  /**
   * Private method that uses winston logger to log message using `warn` level
   * @param {string} fileName name of file where the log message originates from
   * @param {string} text log message
   * @param {unknown} args an arbitrary number of arguments that are converted to strings and logged with the `text`
   */
  private logWarn(fileName: string, text: string, args?: unknown): void {
    if (typeof fileName === "undefined" || !fileName) {
      args ?
        this.logger.warn(Logger.redactText(`${text}${args}`)) :
        this.logger.warn(Logger.redactText(`${text}`));
    } else {
      args ?
        this.logger.warn(Logger.redactText(`${fileName}: ${text}${args}`)) :
        this.logger.warn(Logger.redactText(`${fileName}: ${text}`));
    }
  }

  /**
   * Private method that uses winston logger to log message using `error` level
   * @param {string} fileName name of file where the log message originates from
   * @param {string} text log message
   * @param {unknown} args an arbitrary number of arguments that are converted to strings and logged with the `text`
   */
  private logError(fileName: string, text: string, args?: unknown): void {
    if (typeof fileName === "undefined" || !fileName) {
      args ?
        this.logger.error(Logger.redactText(`${text}${args}`)) :
        this.logger.error(Logger.redactText(`${text}`));
    } else {
      args ?
        this.logger.error(Logger.redactText(`${fileName}: ${text}${args}`)) :
        this.logger.error(Logger.redactText(`${fileName}: ${text}`));
    }
  }

  /**
   * Log message using `info` level
   * @param {string} text log message
   * @param {unknown} args an arbitrary number of arguments that are converted to strings and logged with the `text`
   */
  public info(text: string, args?: unknown): void {
    this.logInfo(this.fileName, text, args);
  }

  /**
   * Log message using `debug` level
   * @param {string} text log message
   * @param {unknown} args an arbitrary number of arguments that are converted to strings and logged with the `text`
   */
  public debug(text: string, args?: unknown): void {
    this.logDebug(this.fileName, text, args);
  }

  /**
   * Log message using `warn` level
   * @param {string} text log message
   * @param {unknown} args an arbitrary number of arguments that are converted to strings and logged with the `text`
   */
  public warn(text: string, args?: unknown): void {
    this.logWarn(this.fileName, text, args);
  }

  /**
   * Log message using `error` level
   * @param {string} text log message
   * @param {unknown} args an arbitrary number of arguments that are converted to strings and logged with the `text`
   */
  public error(text: string, args?: unknown): void {
    this.logError(this.fileName, text, args);
  }

  /**
   * Raw (unredacted) logging is allowed only when LOG_RAW_SECRETS is 'true' and the code
   * is not running in AWS Lambda (AWS_LAMBDA_FUNCTION_NAME is unset).
   * @returns {boolean} true if redaction must be skipped
   */
  public static isRawSecretsAllowed(): boolean {
    return process.env.LOG_RAW_SECRETS === 'true' && !process.env.AWS_LAMBDA_FUNCTION_NAME;
  }

  /**
   * Redact the value of an environment variable unless it is one of the known non-secret variables
   * (the sample's settings and the Lambda runtime's non-secret variables).  Redaction is by default:
   * the AWS credential variables and any variable that isn't listed, whatever its name, are redacted.
   * @param {string} key environment variable name
   * @param {string} value environment variable value
   * @returns {string} the value for a known non-secret variable, otherwise `<redacted>`
   */
  public static redactEnvValue(key: string, value: string | undefined): string | undefined {
    if (value === undefined || Logger.isRawSecretsAllowed()) {
      return value;
    }
    if (LOGGED_ENV_KEYS.includes(key)) {
      return value;
    }
    return REDACTED;
  }

  /**
   * Describe environment variables for debug logging.  NODE_* keys, ALLOW_CONFIG_MUTATIONS and
   * SUPPRESS_NO_CONFIG_WARNING are left out (the constructor logs them separately).
   * Values are redacted with redactEnvValue(), so only known non-secret values are shown.
   * @param {NodeJS.ProcessEnv} env environment, typically process.env
   * @returns {Record<string, string | undefined>} environment variable name to printable value
   */
  public static describeEnvironment(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
    const description: Record<string, string | undefined> = {};
    Object.keys(env).forEach((key) => {
      if (!key.match(/^NODE_.*/) && key !== 'ALLOW_CONFIG_MUTATIONS' && key !== 'SUPPRESS_NO_CONFIG_WARNING') {
        description[key] = Logger.redactEnvValue(key, env[key]);
      }
    });
    return description;
  }

  /**
   * Summarize a JWT for logging: a 12 character prefix, the `kid`/`alg` header fields and a
   * fixed list of claims (sub, username, cognito:username, jti, exp, iat, token_use, scope,
   * client_id, aud).  The signed token itself is never returned.
   * @param {string} token JWT
   * @returns {string} JSON summary of the token
   */
  public static summarizeJwt(token: string): string {
    const pick = (source: Record<string, unknown>, fields: string[]): Record<string, unknown> => {
      const picked: Record<string, unknown> = {};
      fields.forEach((field) => {
        if (source[field] !== undefined) {
          picked[field] = source[field];
        }
      });
      return picked;
    };

    const summary: Record<string, unknown> = { prefix: `${(token || '').substring(0, JWT_PREFIX_LENGTH)}…` };
    try {
      summary.header = pick(jwtDecode<Record<string, unknown>>(token, { header: true }), JWT_SUMMARY_HEADER_FIELDS);
      summary.claims = pick(jwtDecode<Record<string, unknown>>(token), JWT_SUMMARY_CLAIMS);
    } catch ( e ) {
      summary.error = 'undecodable token';
    }
    return JSON.stringify(summary);
  }

  /**
   * Redact a log line: every JWT is replaced with `<jwt {summary}>` and every literal value of
   * AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_SESSION_TOKEN with `<redacted>`.
   * Returns the text unchanged when isRawSecretsAllowed() is true.
   * @param {string} text log line
   * @returns {string} redacted log line
   */
  public static redactText(text: string): string {
    if (typeof text !== 'string' || Logger.isRawSecretsAllowed()) {
      return text;
    }
    let redacted = text.replace(JWT_PATTERN, (jwt) => `<jwt ${Logger.summarizeJwt(jwt)}>`);
    AWS_CREDENTIAL_ENV_KEYS.forEach((key) => {
      const value = process.env[key];
      if (value) {
        redacted = redacted.split(value).join(REDACTED);
      }
    });
    return redacted;
  }

  /**
   * Return a deep copy of an API Gateway / Lambda event that is safe to log:
   * - in `headers` and `multiValueHeaders`, the values of the Authorization, Identification,
   *   Proxy-Authorization, Cookie, Set-Cookie, X-Api-Key and X-Amz-Security-Token headers (any case)
   *   are masked: `Bearer <jwt>` becomes `Bearer <jwt {summary}>`, anything else becomes `<masked>`;
   * - `requestContext.authorizer.claims` (the claims of the token an API Gateway authorizer verified)
   *   keeps only sub, cognito:username, token_use, aud, iss, exp, iat and auth_time, so personal data
   *   such as email and phone_number is not logged;
   * - the `authorizationToken` of a TOKEN authorizer event is masked like a credential header;
   * - a non-empty `body` becomes `<masked>`.
   * The input event is not modified.  Returns an unmasked copy when isRawSecretsAllowed() is true.
   * @param {T} event event object
   * @returns {T} sanitized copy of the event
   */
  public static sanitizeEvent<T>(event: T): T {
    if (event === null || event === undefined || typeof event !== 'object') {
      return event;
    }
    const sanitized = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
    if (Logger.isRawSecretsAllowed()) {
      return sanitized as T;
    }

    const maskValue = (value: unknown): unknown => {
      if (value === null || value === undefined) {
        return value;
      }
      if (typeof value === 'string') {
        const bearer = /^Bearer (.+)$/.exec(value);
        if (bearer && SINGLE_JWT_PATTERN.test(bearer[1])) {
          return `Bearer <jwt ${Logger.summarizeJwt(bearer[1])}>`;
        }
      }
      return MASKED;
    };

    ['headers', 'multiValueHeaders'].forEach((headerMapName) => {
      const headerMap = sanitized[headerMapName];
      if (headerMap && typeof headerMap === 'object') {
        const headers = headerMap as Record<string, unknown>;
        Object.keys(headers).forEach((headerName) => {
          if (SENSITIVE_HEADER_PATTERN.test(headerName)) {
            const value = headers[headerName];
            headers[headerName] = Array.isArray(value) ? value.map(maskValue) : maskValue(value);
          }
        });
      }
    });

    // claims of the token verified by an API Gateway authorizer: keep identifiers, drop personal data
    const requestContext = sanitized.requestContext as Record<string, unknown> | undefined;
    const authorizer = requestContext && typeof requestContext === 'object'
      ? requestContext.authorizer as Record<string, unknown> | undefined
      : undefined;
    if (authorizer && typeof authorizer === 'object' && authorizer.claims !== undefined && authorizer.claims !== null) {
      const claims = authorizer.claims;
      const kept: Record<string, unknown> = {};
      if (typeof claims === 'object') {
        AUTHORIZER_CLAIMS_KEPT.forEach((claim) => {
          const value = (claims as Record<string, unknown>)[claim];
          if (value !== undefined) {
            kept[claim] = value;
          }
        });
      }
      authorizer.claims = kept;
    }

    // TOKEN authorizer event: the caller's credential is the top-level authorizationToken
    if (sanitized.authorizationToken !== undefined) {
      sanitized.authorizationToken = maskValue(sanitized.authorizationToken);
    }

    // request body: may carry user input
    if (typeof sanitized.body === 'string' && sanitized.body.length > 0) {
      sanitized.body = MASKED;
    }
    return sanitized as T;
  }

  /**
   * Silence all transports in winston logger.  Logger class only uses Console transport so this
   * method can be used to disable logging after Logger has been instantiated at runtime.
   * @param {boolean} mode flag that can enable or disable winston logger
   */
  public silentMode(mode: boolean): void {
    this.logger.silent = mode;
  }
}

export { Logger };
