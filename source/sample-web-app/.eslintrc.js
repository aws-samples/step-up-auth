// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/* eslint-env commonjs */
module.exports = {
  // https://eslint.org/docs/user-guide/configuring#specifying-processor
  "plugins": ["jest"],
  // https://eslint.org/docs/user-guide/configuring#specifying-parser-options
  parserOptions: {
    ecmaVersion: 2018, // set to 3, 5 (default), 6, 7, 8, 9, 10 or 11 to specify the version of ECMAScript syntax you want to use. You can also set to 2015 (same as 6), 2016 (same as 7), 2017 (same as 8), 2018 (same as 9), 2019 (same as 10) or 2020 (same as 11) to use the year-based naming.
    sourceType: 'module',  // set to "script" (default) or "module" if your code is in ECMAScript modules.
    ecmaFeatures: { // an object indicating which additional language features you'd like to use
      impliedStrict: true, // enable global strict mode (if ecmaVersion is 5 or greater)
      jsx: true // enable JSX
    }
  },
  // https://eslint.org/docs/user-guide/configuring#specifying-environments
  env: {
    browser: true, // enable browser global variables, i.e. console, window etc
    // jest: true, // Jest global variables.
  },
  // https://eslint.org/docs/user-guide/configuring#extending-configuration-files
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "plugin:jest/recommended",
    "plugin:jest/style"
  ],
  // https://eslint.org/docs/user-guide/configuring#configuring-rules
  rules: {
    // Place to specify ESLint rules. Can be used to overwrite rules specified from the extended configs
    "no-unused-vars": ["warn", {"argsIgnorePattern": "^_", "varsIgnorePattern": "^_"}], // disallow declaration of variables that are not used in the code (recommended)
    "semi": ["error", "always"],
    "jsx-quotes": [2, "prefer-double"] // specify whether double or single quotes should be used in JSX attributes (fixable)
  }
};
