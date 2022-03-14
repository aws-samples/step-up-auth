// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, beforeAll } from '@jest/globals';
import * as path from 'path';
import { Logger } from '../index';
import config from 'config';

describe('Logger Test Suite', () => {
  let log: Logger;

  beforeAll(() => {
    // initialize globals
    const fileName = path.basename(__filename);
    log = new Logger(fileName);
  });

  it('logs output', async () => {
    log.debug('hello');
    expect(true).toBe(true);
  });
});

describe('Test Suite for config', () => {
  beforeAll(() => {
    if (process.env.NODE_ENV === 'local' || process.env.NODE_ENV === 'test') {
      process.env.NODE_CONFIG_DIR = path.join(__dirname, '/../test/config');
    } else {
      process.env.NODE_CONFIG_DIR = path.join(__dirname, 'config/');
    }
  });
  it('environment is set properly', async () => {
    // test NODE_ENV
    expect(process.env.NODE_ENV).toEqual("test");

    // test NODE_CONFIG_DIR
    const re = /.*\/test\/config$/;
    const configDir: string = process.env.NODE_CONFIG_DIR!;
    expect(configDir.match(re)).not.toBeNull();

  });
  it('reads configuration from file', async () => {
    const level = config.get('logging.level');
    const colorize = config.get('logging.colorize_console');
    const timestamp = config.get('logging.show_timestamp');
    expect(level).not.toBeNull();
    expect(colorize).not.toBeNull();
    expect(timestamp).not.toBeNull();
  });
});
