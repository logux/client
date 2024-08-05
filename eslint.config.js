import loguxTsConfig from '@logux/eslint-config/ts'
import globals from 'globals'

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    ignores: ['test/demo/dist', '**/errors.ts']
  },
  ...loguxTsConfig,
  {
    languageOptions: {
      globals: globals.browser
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'camelcase': 'off',
      'n/no-unsupported-features/node-builtins': [
        'error',
        {
          ignores: [
            'WebSocket',
            'navigator',
            'crypto',
            'CryptoKey',
            'localStorage'
          ]
        }
      ],
      'no-console': 'off',
      'symbol-description': 'off'
    }
  }
]
