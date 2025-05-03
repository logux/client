import loguxTsConfig from '@logux/eslint-config/ts'
import globals from 'globals'

/** @type {import('eslint').Linter.Config[]} */
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
            'localStorage',
            'CompressionStream',
            'Response',
            'DecompressionStream',
            'crypto',
            'CryptoKey'
          ]
        }
      ],
      'no-console': 'off',
      'symbol-description': 'off'
    }
  },
  {
    files: ['indexed-store/index.test.ts'],
    rules: {
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off'
    }
  }
]
