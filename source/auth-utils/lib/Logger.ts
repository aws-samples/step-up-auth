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

// environment variables that hold AWS credentials.  Their values are always redacted
const AWS_CREDENTIAL_ENV_KEYS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];
// any other environment variable whose name matches this pattern is redacted as well
const SENSITIVE_ENV_KEY_PATTERN = /SECRET|TOKEN|PASSWORD|CREDENTIAL/i;
// request headers whose values are masked by sanitizeEvent()
const SENSITIVE_HEADER_PATTERN = /^(authorization|identification)$/i;
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

    // display some runtime configuration information
    this.logger.debug('Node Environment:');
    this.logger.debug(`NODE_ENV: ${process.env.NODE_ENV}`);
    this.logger.debug(`NODE_CONFIG_ENV: ${process.env.NODE_CONFIG_ENV}`);
    this.logger.debug(`NODE_CONFIG_DIR: ${process.env.NODE_CONFIG_DIR}`);
    this.logger.debug(`NODE_CONFIG: ${process.env.NODE_CONFIG}`);
    this.logger.debug(`NODE_APP_INSTANCE: ${process.env.NODE_APP_INSTANCE}`);
    this.logger.debug(`NODE_CONFIG_PARSER: ${process.env.NODE_CONFIG_PARSER}`);
    this.logger.debug(`ALLOW_CONFIG_MUTATIONS: ${process.env.ALLOW_CONFIG_MUTATIONS}`);
    this.logger.debug(`SUPPRESS_NO_CONFIG_WARNING: ${process.env.SUPPRESS_NO_CONFIG_WARNING}`);

    // display remaining environment variables (credential values are redacted)
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
   * Redact the value of a credential environment variable: the three AWS_* credential keys
   * and any key whose name contains SECRET, TOKEN, PASSWORD or CREDENTIAL.
   * @param {string} key environment variable name
   * @param {string} value environment variable value
   * @returns {string} `<redacted>` for credential keys, otherwise the value unchanged
   */
  public static redactEnvValue(key: string, value: string | undefined): string | undefined {
    if (value === undefined || Logger.isRawSecretsAllowed()) {
      return value;
    }
    if (AWS_CREDENTIAL_ENV_KEYS.includes(key) || SENSITIVE_ENV_KEY_PATTERN.test(key)) {
      return REDACTED;
    }
    return value;
  }

  /**
   * Describe environment variables for debug logging.  NODE_* keys, ALLOW_CONFIG_MUTATIONS and
   * SUPPRESS_NO_CONFIG_WARNING are left out (the constructor logs them separately).
   * Credential values are redacted with redactEnvValue().
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
   * Return a deep copy of an API Gateway / Lambda event that is safe to log.  In `headers` and
   * `multiValueHeaders`, values of the Authorization and Identification headers (any case) are
   * masked: `Bearer <jwt>` becomes `Bearer <jwt {summary}>`, anything else becomes `<masked>`.
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
