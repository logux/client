import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    coverage: {
      provider: 'c8',
      reporter: 'lcov',
      lines: 100
    }
  }
})
