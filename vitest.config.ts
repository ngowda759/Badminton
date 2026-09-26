import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for unit and integration tests.
 *
 * `tests/unit` covers pure logic and the database health abstraction with
 * stubs. `tests/integration` builds a real Fastify instance via `buildApp()`
 * and drives it with `app.inject()`, so no socket is bound and no external
 * server has to be running.
 *
 * `e2e/` is excluded because Playwright owns those specs.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'packages/**/src/**/*.test.ts', 'apps/api/tests/**/*.test.ts'],
    exclude: ['node_modules/**', '**/dist/**', 'e2e/**'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['apps/api/src/**', 'packages/*/src/**'],
      exclude: ['**/*.d.ts', '**/generated/**'],
    },
  },
});
