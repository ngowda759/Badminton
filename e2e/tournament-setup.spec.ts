import { expect, test } from '@playwright/test';

/**
 * Phase 4 setup flow.
 *
 * Creates a tournament, opens registration, creates a category and a player,
 * then registers the player in the category. Each record is created through
 * the UI, so the flow only succeeds if the pages, API client and REST API agree
 * on the real contracts.
 *
 * Requires PostgreSQL and migrations (`docker compose up -d postgres` and
 * `npm run db:migrate`), which the Playwright `webServer` block already
 * depends on for the API health check.
 */
test.describe('tournament setup', () => {
  test('create tournament → open registration → create category → create player → register entry', async ({
    page,
  }) => {
    const unique = Date.now();
    const tournamentName = `E2E Tournament ${unique}`;
    const categoryName = `E2E Singles ${unique}`;
    const categoryCode = `E2E${String(unique).slice(-3)}`;
    const playerName = `E2E Player ${unique}`;

    // Create the tournament.
    await page.goto('/tournaments/new');
    await page.getByLabel(/^Name/).fill(tournamentName);
    await page.getByLabel(/^Start date/).fill('2026-10-01');
    await page.getByLabel(/^End date/).fill('2026-10-05');
    await page.getByRole('button', { name: 'Create tournament' }).click();

    await expect(page.getByRole('heading', { name: tournamentName })).toBeVisible();
    const tournamentUrl = page.url();

    // Open registration so entries can be accepted.
    await page.getByRole('button', { name: 'Registration Open' }).click();
    await expect(page.getByText('Registration open').first()).toBeVisible();

    // Create a singles category.
    await page.goto(`${tournamentUrl}/categories/new`);
    await page.getByLabel(/^Name/).fill(categoryName);
    await page.getByLabel(/^Code/).fill(categoryCode);
    await page.getByRole('button', { name: 'Create category' }).click();

    await expect(page.getByRole('heading', { name: categoryName })).toBeVisible();

    // Open the category so it can accept registrations.
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByText('Open', { exact: true }).first()).toBeVisible();

    // Create a player and capture its id for registration.
    await page.goto('/players');
    await page.getByLabel(/^Name/).fill(playerName);
    await page.getByRole('button', { name: 'Create player' }).click();
    const playerLink = page.getByRole('link', { name: playerName });
    await expect(playerLink).toBeVisible();

    const playerHref = await playerLink.getAttribute('href');
    const playerId = playerHref?.split('/').pop() ?? '';
    expect(playerId.length).toBeGreaterThan(0);

    // Register the player in the category.
    await page.goto(`${tournamentUrl}/categories`);
    await page.getByRole('link', { name: 'Open' }).first().click();
    await page.getByRole('link', { name: 'Entries' }).click();

    await page.getByLabel(/^Player ID/).fill(playerId);
    await page.getByRole('button', { name: 'Register' }).click();

    // The entry now appears in the list, resolved to the player's name.
    await expect(page.getByRole('cell', { name: playerName })).toBeVisible({ timeout: 15_000 });
  });
});
