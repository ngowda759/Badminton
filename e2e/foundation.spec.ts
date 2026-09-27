import { expect, test } from '@playwright/test';

/**
 * Phase 1 smoke test.
 *
 * Proves the browser, the web bundle and the API are wired together: the shell
 * renders and the status panel - which is fed exclusively by `GET /health` -
 * reports both the API and PostgreSQL as connected.
 *
 * Playwright starts the API and the web dev server itself (see
 * `playwright.config.ts`), so this spec never depends on manually started
 * services. PostgreSQL and migrations are still prerequisites.
 */

test.describe('foundation shell', () => {
  test('renders the application shell', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Badminton Tournament Manager' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Foundation is running.' })).toBeVisible();
    await expect(page.getByTestId('health-panel')).toBeVisible();
  });

  test('displays the API health status reported by the backend', async ({ page }) => {
    await page.goto('/');

    const apiStatus = page.getByTestId('api-status');
    const databaseStatus = page.getByTestId('database-status');

    await expect(apiStatus).toContainText('Connected', { timeout: 15_000 });
    await expect(databaseStatus).toContainText('Connected', { timeout: 15_000 });
    await expect(page.getByTestId('overall-status')).toContainText('All systems operational');
  });

  test('reports a healthy API through the health endpoint', async ({ request }) => {
    const apiPort = process.env.API_PORT ?? '3000';
    const response = await request.get(`http://127.0.0.1:${apiPort}/health`);

    // Cross-checks that the status the UI renders comes from a live API rather
    // than a client-side default.
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: 'connected' });
  });
});
