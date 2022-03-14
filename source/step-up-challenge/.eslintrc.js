// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

module.exports = {
  // https://eslint.org/docs/user-guide/configuring#specifying-processor
  'plugins': ['jest'],
  parser: '@typescript-eslint/parser',  // Specifies the ESLint parser
  // https://eslint.org/docs/user-guide/configuring#specifying-parser-options
  parserOptions: {
    ecmaVersion: 2020,  // Allows for the parsing of modern ECMAScript features
    sourceType: 'module',  // Allows for the use of imports
  },
  // https://eslint.org/docs/user-guide/configuring#specifying-environments
  env: {
    browser: true, // enable browser global variables, i.e. console, window etc
    jest: true, // Jest global variables.
    // 'jest/globals': true, // https://github.com/jest-community/eslint-plugin-jest#readme
    node: true, // Node.js global variables and Node.js scoping.
    es6: true // enable all ECMAScript 6 features except for modules (this automatically sets the ecmaVersion parser option to 6).
  },
  // https://eslint.org/docs/user-guide/configuring#extending-configuration-files
  extends: [
    'plugin:@typescript-eslint/recommended',  // Uses the recommended rules from the @typescript-eslint/eslint-plugin
    'eslint:recommended',
    'plugin:jest/recommended',
    'plugin:jest/style'
    // 'prettier/@typescript-eslint',  // Uses eslint-config-prettier to disable ESLint rules from @typescript-eslint/eslint-plugin that would conflict with prettier
    // 'plugin:prettier/recommended',  // Enables eslint-plugin-prettier and displays prettier errors as ESLint errors. Make sure this is always the last configuration in the extends array.
  ],
  rules: {
    // Place to specify ESLint rules. Can be used to overwrite rules specified from the extended configs
    // e.g. '@typescript-eslint/explicit-function-return-type': 'off',
    semi: ['error', 'always'],
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }], // disallow declaration of variables that are not used in the code (recommended)
    'space-before-function-paren': [0, { anonymous: 'always', named: 'never' }], // require or disallow a space before function opening parenthesis (fixable)
    'require-yield': ['warn'],
    '@typescript-eslint/no-inferrable-types': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off'
  },
};
