import { expect, test } from '@playwright/test';

/**
 * Named participant selection (parity gap G14), against the real UI/API/PostgreSQL.
 *
 * A GROUP match's slots are filled by choosing each competitor from a dropdown
 * over the category's eligible entries - never by typing a raw entry UUID. The
 * two competitor names appear in the slot summaries and the match then starts.
 *
 * Requires PostgreSQL and migrations (`docker compose up -d postgres` and
 * `npm run db:migrate`), which the Playwright `webServer` block depends on for
 * the API health check.
 */
test.describe('participant selection', () => {
  test('assign both slots by choosing competitors by name', async ({ page }) => {
    const unique = Date.now();
    const tournamentName = `E2E Selection ${unique}`;
    const categoryName = `E2E Selection Group ${unique}`;
    const categoryCode = `P${String(unique).slice(-4)}`;
    const playerOne = `E2E Priya ${unique}`;
    const playerTwo = `E2E Rahul ${unique}`;

    // Create the tournament and open registration.
    await page.goto('/tournaments/new');
    await page.getByLabel(/^Name/).fill(tournamentName);
    await page.getByLabel(/^Start date/).fill('2026-10-01');
    await page.getByLabel(/^End date/).fill('2026-10-05');
    await page.getByRole('button', { name: 'Create tournament' }).click();
    await expect(page.getByRole('heading', { name: tournamentName })).toBeVisible();
    const tournamentUrl = page.url();

    await page.getByRole('button', { name: 'Registration Open' }).click();
    await expect(page.getByText('Registration open').first()).toBeVisible();

    // Create a singles category and open it.
    await page.goto(`${tournamentUrl}/categories/new`);
    await page.getByLabel(/^Name/).fill(categoryName);
    await page.getByLabel(/^Code/).fill(categoryCode);
    await page.getByRole('button', { name: 'Create category' }).click();
    await expect(page.getByRole('heading', { name: categoryName })).toBeVisible();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByText('Open', { exact: true }).first()).toBeVisible();
    const categoryUrl = page.url();

    // Create two players.
    for (const name of [playerOne, playerTwo]) {
      await page.goto('/players');
      await page.getByLabel(/^Name/).fill(name);
      await page.getByRole('button', { name: 'Create player' }).click();
      await expect(page.getByRole('link', { name })).toBeVisible();
    }

    // Register both players as active entries.
    await page.goto(`${categoryUrl}/entries`);
    for (const name of [playerOne, playerTwo]) {
      await page.getByLabel('Player').click();
      await page.getByRole('option', { name }).click();
      await page.getByRole('button', { name: 'Register' }).click();
      await expect(page.getByRole('cell', { name })).toBeVisible({ timeout: 15_000 });
    }

    // Create a GROUP stage and a match.
    await page.goto(`${categoryUrl}/stages`);
    await page.getByLabel(/^Name/).fill('Group A');
    await page.getByRole('button', { name: 'Create stage' }).click();
    const stageLink = page.locator('a[href*="/stages/"]');
    await expect(stageLink).toBeVisible();
    await stageLink.click();

    await page.getByRole('button', { name: 'Create match' }).click();
    const matchLink = page.locator('a[href*="/matches/"]');
    await expect(matchLink).toBeVisible();
    await matchLink.click();
    await expect(page).toHaveURL(/\/matches\//);

    // No raw-UUID input is present: the slot is a labelled dropdown.
    await expect(page.getByLabel('Slot 1 participant')).toBeVisible();
    await expect(page.getByLabel('Slot 2 participant')).toBeVisible();
    await expect(page.getByPlaceholder('Entry UUID')).toHaveCount(0);

    // Choose each competitor by name; no id is ever typed.
    await page.getByLabel('Slot 1 participant').click();
    await page.getByRole('option', { name: playerOne }).click();
    await page.getByRole('button', { name: 'Assign' }).first().click();
    await expect(page.getByText(playerOne).first()).toBeVisible({ timeout: 15_000 });

    await page.getByLabel('Slot 2 participant').click();
    await page.getByRole('option', { name: playerTwo }).click();
    await page.getByRole('button', { name: 'Assign' }).first().click();
    await expect(page.getByText(playerTwo).first()).toBeVisible({ timeout: 15_000 });

    // Both competitor names appear in the slot summaries.
    const summaries = page.locator('dl');
    await expect(summaries.getByText(playerOne)).toBeVisible();
    await expect(summaries.getByText(playerTwo)).toBeVisible();

    // The match then transitions to IN_PROGRESS.
    await page.getByRole('button', { name: 'In Progress' }).click();
    await expect(page.getByText('In progress').first()).toBeVisible();
  });
});
