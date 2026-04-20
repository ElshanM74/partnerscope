import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Load env shim BEFORE any test file imports `src/config/env.ts`.
    setupFiles: ['./test/setup-env.ts'],
    passWithNoTests: true,
    include: ['src/**/*.test.ts'],
    reporters: ['default'],
  },
});
