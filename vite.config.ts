import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      exclude: ['*/errors.ts', '*/types.ts', '**/*.d.ts', 'test/demo'],
      provider: 'v8',
      thresholds: {
        lines: 100
      }
    },
    environment: 'happy-dom'
  }
})
