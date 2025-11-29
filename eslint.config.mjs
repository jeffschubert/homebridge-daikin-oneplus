import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import promisePlugin from 'eslint-plugin-promise';
import globals from 'globals';

export default [
  {
    ignores: ['**/dist'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      promise: promisePlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,

      'dot-notation': 'off',
      eqeqeq: 'warn',
      curly: ['warn', 'all'],
      'prefer-arrow-callback': ['warn'],
      'no-console': ['warn'],
      'no-non-null-assertion': ['off'],

      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // Enforce async/await over .then()/.catch()
      'promise/prefer-await-to-then': 'error',
      'promise/prefer-await-to-callbacks': 'warn',
    },
  },
  prettier,
];
