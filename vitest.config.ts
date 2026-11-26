import { defineConfig } from 'vitest/config';

export default defineConfig({
  envDir: false,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx,mjs,js}'],
    exclude: ['tests/e2e/**', 'tests/database/**', 'node_modules/**', 'android/**'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    clearMocks: true,
  },
});
