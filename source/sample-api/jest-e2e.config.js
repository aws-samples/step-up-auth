// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

module.exports = {
  // https://jestjs.io/docs/en/configuration#globals-object
  globals: {
    "ts-jest": {
      tsconfig: "tsconfig.json"
    }
  },

  // https://jestjs.io/docs/en/configuration#testregex-string--arraystring
  testRegex: '(/test/e2e/.*.(test|spec)).(js|ts)$',

  // https://jestjs.io/docs/en/configuration#testenvironment-string
  testEnvironment: 'node',

  // https://jestjs.io/docs/en/configuration#testpathignorepatterns-arraystring
  testPathIgnorePatterns: ["/node_modules/"],

  // https://jestjs.io/docs/en/configuration#transform-objectstring-pathtotransformer--pathtotransformer-object
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },

  // https://jestjs.io/docs/en/configuration#modulefileextensions-arraystring
  moduleFileExtensions: [
    "ts",
    "js"
  ],

  // https://jestjs.io/docs/en/configuration#coveragethreshold-object
  // coverageThreshold: {
  //   global: {
  //       branches: 80,
  //       functions: 80,
  //       lines: 80,
  //       statements: 80
  //   }
  // },

  // https://jestjs.io/docs/en/configuration#collectcoveragefrom-array
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!src/*.jsx',
    '!src/config.js'
  ],

  // https://jestjs.io/docs/en/configuration#clearmocks-boolean
  // Automatically clear mock calls and instances between every test
  // clearMocks: true,

  // https://jestjs.io/docs/en/configuration#verbose-boolean
  // Indicates whether each individual test should be reported during the run
  verbose: false
};
