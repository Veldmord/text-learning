import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'public', 'dev-dist', 'node_modules', 'playwright-report', 'test-results', '.tts-cache', 'tools/tts/**/*.py'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-restricted-imports': 'off',
    },
  },
  {
    // engine/* — чистый TypeScript без React и браузерных API (раздел 7.2)
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['react', 'react-dom', 'zustand', 'dexie', '../audio/*', '../storage/*', '../features/*', '../app/*'] }],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'navigator', 'indexedDB', 'fetch'],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
);
