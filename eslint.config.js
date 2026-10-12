// @ts-check
import js from '@eslint/js';
import compat from 'eslint-plugin-compat';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

const D12 = 'M1-PLAN D12: build DOM nodes with h() and textContent; admin-entered text must never become markup or script.';

/** setAttribute / setAttributeNS with a literal or template name starting with "on". */
const EVENT_ATTR = "/^on/i";

export default defineConfig(
  {
    ignores: [
      'node_modules/**',
      'plugin/wg-live/assets/dist/**',
      'artifacts/**',
      'evidence/**',
      'playwright-report/**',
      'playwright-report-integration/**',
      'blob-report/**',
      'test-results/**',
      'coverage/**',
      '.cache/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Browser code that ships (src/) or runs in the page (dev harness client code).
    // eslint-plugin-compat reads the browserslist entry in package.json (M1-PLAN D15).
    files: ['src/**/*.ts', 'dev/client/**/*.ts'],
    extends: [compat.configs['flat/recommended']],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // D12 bans: markup and script sinks. Also covers the wp-admin script that ships in the ZIP (admin-entered rows).
    files: ['src/**/*.ts', 'dev/**/*.ts', 'plugin/wg-live/assets/admin/**/*.js'],
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: D12 },
        { property: 'outerHTML', message: D12 },
        { property: 'insertAdjacentHTML', message: D12 },
        { property: 'srcdoc', message: D12 },
        { object: 'document', property: 'write', message: D12 },
        { object: 'document', property: 'writeln', message: D12 },
      ],
      'no-restricted-syntax': [
        'error',
        {
          // Destructuring such as const { innerHTML } = el
          selector: 'ObjectPattern > Property[key.name=/^(innerHTML|outerHTML|srcdoc)$/]',
          message: D12,
        },
        {
          // el.setAttribute('onclick', ...), el.setAttributeNS(null, 'onclick', ...)
          selector: `CallExpression[callee.property.name=/^setAttribute$/][arguments.0.type='Literal'][arguments.0.value=${EVENT_ATTR}]`,
          message: `${D12} Event-handler attributes (on*) are not allowed.`,
        },
        {
          selector: `CallExpression[callee.property.name='setAttributeNS'][arguments.1.type='Literal'][arguments.1.value=${EVENT_ATTR}]`,
          message: `${D12} Event-handler attributes (on*) are not allowed.`,
        },
        {
          selector: `CallExpression[callee.property.name=/^(setAttribute|setAttributeNS)$/] TemplateElement[value.cooked=${EVENT_ATTR}]`,
          message: `${D12} Event-handler attributes (on*) are not allowed.`,
        },
      ],
    },
  },
  {
    // Node code: build scripts, tool configs and the dev server middleware (runs in Node).
    files: ['scripts/**/*.mjs', '*.config.ts', '*.config.js', 'dev/*.ts', 'dev/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // wp-admin helper script for the plugin's own screens: plain browser JavaScript, no build step.
    // wp and jQuery are provided by WordPress at runtime.
    files: ['plugin/wg-live/assets/admin/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, wp: 'readonly', jQuery: 'readonly' } },
  },
  {
    files: ['tests/unit/**/*.ts', 'tests/setup/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['tests/e2e/**/*.ts', 'tests/integration/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
