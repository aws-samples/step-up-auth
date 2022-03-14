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

    const customFormat = winston.format.printf((i: { level: string, message: string; timestamp?: string}) => {
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

    // filter out runtime configuration already shown above
    Object.keys(process.env).forEach((key) => {
      if (!key.match(/^NODE_.*/) && key !== 'ALLOW_CONFIG_MUTATIONS' && key !== 'SUPPRESS_NO_CONFIG_WARNING') {
        this.logger.debug(`${key}: ${process.env[key]}`);
      }
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
        this.logger.info(`${text}${args}`) :
        this.logger.info(`${text}`);
    } else {
      args ?
        this.logger.info(`${fileName}: ${text}${args}`) :
        this.logger.info(`${fileName}: ${text}`);
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
        this.logger.debug(`${text}${args}`) :
        this.logger.debug(`${text}`);
    } else {
      args ?
        this.logger.debug(`${fileName}: ${text}${args}`) :
        this.logger.debug(`${fileName}: ${text}`);
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
        this.logger.warn(`${text}${args}`) :
        this.logger.warn(`${text}`);
    } else {
      args ?
        this.logger.warn(`${fileName}: ${text}${args}`) :
        this.logger.warn(`${fileName}: ${text}`);
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
        this.logger.error(`${text}${args}`) :
        this.logger.error(`${text}`);
    } else {
      args ?
        this.logger.error(`${fileName}: ${text}${args}`) :
        this.logger.error(`${fileName}: ${text}`);
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
   * Silence all transports in winston logger.  Logger class only uses Console transport so this
   * method can be used to disable logging after Logger has been instantiated at runtime.
   * @param {boolean} mode flag that can enable or disable winston logger
   */
  public silentMode(mode: boolean): void {
    this.logger.silent = mode;
  }
}

export { Logger };
