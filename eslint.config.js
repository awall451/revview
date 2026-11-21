// Flat config, written without @eslint/js or globals to keep two dev dependencies.
const nodeGlobals = {
  console: 'readonly', process: 'readonly', URL: 'readonly', setTimeout: 'readonly',
  clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
};
const browserGlobals = {
  window: 'readonly', document: 'readonly', console: 'readonly', setTimeout: 'readonly',
  clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  fetch: 'readonly', EventSource: 'readonly', WebSocket: 'readonly', URL: 'readonly',
  requestAnimationFrame: 'readonly',
};
const rules = {
  'no-undef': 'error', 'no-unused-vars': 'error', 'no-var': 'error', 'prefer-const': 'error',
  eqeqeq: 'error', 'no-redeclare': 'error', 'no-unreachable': 'error', 'no-dupe-keys': 'error',
  'no-dupe-args': 'error', 'no-const-assign': 'error', 'no-self-assign': 'error',
  'no-empty': 'error', 'no-fallthrough': 'error', 'use-isnan': 'error', 'valid-typeof': 'error',
};
export default [
  { ignores: ['node_modules/', 'out/', 'test-results/'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: nodeGlobals },
    rules,
  },
  { files: ['src/view/**/*.js'], languageOptions: { globals: browserGlobals } },
];
