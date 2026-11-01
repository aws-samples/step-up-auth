// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jest from 'eslint-plugin-jest';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  { ignores: ['node_modules/', 'dist/', 'coverage/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    ...react.configs.flat.recommended,
    settings: { react: { version: 'detect' } },
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
    },
  },
  reactHooks.configs.flat.recommended,
  { files: ['tests/**/*.js'], ...jest.configs['flat/recommended'] },
  { files: ['tests/**/*.js'], ...jest.configs['flat/style'] },
  { files: ['tests/**/*.js'], languageOptions: { globals: { ...globals.browser, ...globals.jest } } },
  {
    files: ['webpack.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    rules: {
      // caughtErrors 'none' keeps the ESLint 8 default
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      semi: ['error', 'always'],
      'jsx-quotes': ['error', 'prefer-double'],
    },
  },
]);
