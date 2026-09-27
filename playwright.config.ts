import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

/**
 * Playwright configuration.
 *
 * Both applications are started automatically by `webServer`, so `npm run
 * test:e2e` works from a clean checkout without manually starting anything.
 * `reuseExistingServer` keeps local iteration fast when a dev server is already
 * running, but CI always starts fresh.
 *
 * Prerequisites: PostgreSQL must be up (`docker compose up -d postgres`) and
 * migrations applied (`npm run db:migrate`), because the API's `/health`
 * endpoint reports the database as connected only when it can reach it.
 */
loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);

const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;
// Browsers treat `localhost` and `127.0.0.1` as distinct origins, so the
// browser is pointed at the same hostname the API's CORS allowlist expects.
const WEB_BASE_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: WEB_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'npm run dev:api',
      url: `${API_BASE_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev:web',
      url: WEB_BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
