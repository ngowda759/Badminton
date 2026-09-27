import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Resolves the `@/*` alias declared in `tsconfig.json`. */
const srcAlias = fileURLToPath(new URL('./src', import.meta.url));

/**
 * Vitest configuration for the web workspace.
 *
 * The frontend tests run in a jsdom environment so components and hooks can be
 * rendered with Testing Library. The API boundary is mocked in tests, so no
 * database or running API is required - real API/database integration stays
 * covered by the backend suites.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': srcAlias },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    clearMocks: true,
    restoreMocks: true,
  },
});
