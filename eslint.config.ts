import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ConfigObject, Plugin } from '@eslint/core';
import js from '@eslint/js';
import json from '@eslint/json';
import vitest from '@vitest/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier';
import baselineJs from 'eslint-plugin-baseline-js';
// TRACK: Upgrade ESLint to 10 when these plugin fixes are released:
// https://github.com/jsx-eslint/eslint-plugin-react/issues/3977
// https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/issues/1075
import jsxA11y from 'eslint-plugin-jsx-a11y';
import packageJson from 'eslint-plugin-package-json/experimental';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
// TRACK: Upgrade TypeScript to 7 when typescript-eslint supports it:
// https://github.com/typescript-eslint/typescript-eslint/issues/10940
import tseslint from 'typescript-eslint';

const rootDir = dirname(fileURLToPath(import.meta.url));

const JS_TS_FILES = ['**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts}'];
const TEST_FILES = ['**/*.test.{js,jsx,ts,tsx,cjs,mjs,cts,mts}'];

export default defineConfig([
  globalIgnores(['coverage/**', 'dist/**', 'CHANGELOG.md', 'pnpm-lock.yaml']),
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: rootDir },
    },
  },
  {
    files: JS_TS_FILES,
    ...js.configs.recommended,
  },
  {
    files: JS_TS_FILES,
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
  {
    files: ['**/*.json'],
    language: 'json/json',
    ...json.configs.recommended,
  },
  {
    // cspell reads its JSON config with comments.
    files: ['**/cspell.json'],
    language: 'json/jsonc',
  },
  {
    // Unlike the other presets spread here, this one declares its own `files`, so
    // the glob has to follow the spread to stay authoritative.
    ...packageJson.configs.recommended,
    files: ['**/package.json'],
  },
  {
    files: JS_TS_FILES,
    plugins: { 'baseline-js': baselineJs as Plugin },
    rules: {
      'baseline-js/use-baseline': ['error', { available: 'newly' }],
    },
  },
  baselineJs.configs.recommended({
    available: 'newly',
  }) as unknown as ConfigObject,
  baselineJs.configs['recommended-ts']({
    available: 'newly',
  }) as unknown as ConfigObject,
  prettierConfig,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: JS_TS_FILES,
  })),
  {
    files: JS_TS_FILES,
    plugins: {
      react,
      'react-hooks': reactHooks as Plugin,
    },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unknown-property': 'off',
    },
  },
  {
    files: JS_TS_FILES,
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      'jsx-a11y/alt-text': 'warn',
      'jsx-a11y/aria-props': 'warn',
      'jsx-a11y/aria-proptypes': 'warn',
      'jsx-a11y/aria-unsupported-elements': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'warn',
      'jsx-a11y/role-supports-aria-props': 'warn',
    },
  },
  {
    files: TEST_FILES,
    plugins: { vitest },
    rules: vitest.configs.recommended.rules,
    settings: { vitest: { typecheck: true } },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: true, sourceType: 'module' },
      globals: vitest.environments.env.globals,
    },
  },
]);
