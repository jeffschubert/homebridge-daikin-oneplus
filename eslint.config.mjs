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
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',

      // Enforce async/await over .then()/.catch()
      'promise/prefer-await-to-then': 'error',
      'promise/prefer-await-to-callbacks': 'warn',

      // Enforce explicit visibility modifiers on class members
      '@typescript-eslint/explicit-member-accessibility': 'error',
    },
  },
  prettier,
];
