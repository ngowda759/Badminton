import { expect, test } from '@playwright/test';

/**
 * Phase 1 smoke test.
 *
 * Proves the browser, the web bundle and the API are wired together: the shell
 * renders and the API reports PostgreSQL as connected. The Phase 1 health panel
 * was folded into the application shell in Phase 4; `GET /health` is unchanged
 * and is still what the API liveness check below exercises.
 *
 * Playwright starts the API and the web dev server itself (see
 * `playwright.config.ts`), so this spec never depends on manually started
 * services. PostgreSQL and migrations are still prerequisites.
 */

test.describe('foundation shell', () => {
  test('renders the application shell', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('banner')).toContainText('Badminton Tournament Manager');
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tournaments' })).toBeVisible();
  });

  test('displays the API health status reported by the backend', async ({ page }) => {
    await page.goto('/status');

    const apiStatus = page.getByTestId('api-status');
    const databaseStatus = page.getByTestId('database-status');

    await expect(apiStatus).toContainText('Connected', { timeout: 15_000 });
    await expect(databaseStatus).toContainText('Connected', { timeout: 15_000 });
    await expect(page.getByTestId('overall-status')).toContainText('All systems operational');
  });

  test('navigates to the tournament entry point', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/tournaments$/);
    await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create tournament' }).first()).toBeVisible();
  });

  test('reports a healthy API through the health endpoint', async ({ request }) => {
    const apiPort = process.env.API_PORT ?? '3000';
    const response = await request.get(`http://127.0.0.1:${apiPort}/health`);

    // Cross-checks that the API is live and can reach PostgreSQL.
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: 'connected' });
  });
});
