import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      lines: 100,
      provider: 'v8'
    },
    environment: 'happy-dom'
  }
})
