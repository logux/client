import loguxOxlintConfig from '@logux/oxc-configs/lint'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [loguxOxlintConfig],
  ignorePatterns: ['test/demo/dist', '**/errors.ts'],
  rules: {
    'typescript/no-unnecessary-type-parameters': 'off',
    'typescript/no-unnecessary-type-arguments': 'off',
    'unicorn/prefer-add-event-listener': 'off',
    'unicorn/consistent-function-scoping': 'off',
    'symbol-description': 'off',
    'no-console': 'off'
  },
  overrides: [
    {
      files: ['**/*.ts'],
      rules: {
        'typescript/no-explicit-any': 'off'
      }
    },
    {
      files: ['**/*.test.ts', 'test/**'],
      rules: {
        'no-new': 'off'
      }
    }
  ]
})
