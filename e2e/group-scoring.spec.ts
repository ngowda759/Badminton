import { expect, test } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * Phase 5 group-stage scoring flow, against the real UI, API and PostgreSQL.
 *
 * Registers two players, creates a GROUP stage and a match, assigns both slots,
 * starts the match, records a 2-0 badminton result and confirms the match is
 * COMPLETED with the derived winner reflected in the group standings. Nothing
 * is mocked: every step goes through the running Fastify API and the database.
 *
 * Requires PostgreSQL and migrations (`docker compose up -d postgres` and
 * `npm run db:migrate`), which the Playwright `webServer` block depends on for
 * the API health check.
 */
test.describe('group-stage scoring', () => {
  test('score a group match and see it in the standings', async ({ page }) => {
    const unique = Date.now();
    const tournamentName = `E2E Scoring ${unique}`;
    const categoryName = `E2E Group ${unique}`;
    const categoryCode = `S${String(unique).slice(-4)}`;
    const playerOne = `E2E Alice ${unique}`;
    const playerTwo = `E2E Bob ${unique}`;

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

    // Create two players, capturing their ids for registration.
    const playerIds: string[] = [];
    for (const name of [playerOne, playerTwo]) {
      await page.goto('/players');
      await page.getByLabel(/^Name/).fill(name);
      await page.getByRole('button', { name: 'Create player' }).click();
      const link = page.getByRole('link', { name });
      await expect(link).toBeVisible();
      const href = await link.getAttribute('href');
      const id = href?.split('/').pop() ?? '';
      expect(id.length).toBeGreaterThan(0);
      playerIds.push(id);
    }

    // Register both players, choosing each from the server-backed list and
    // waiting for its row before the next submission.
    await page.goto(`${categoryUrl}/entries`);
    const names = [playerOne, playerTwo];
    for (const name of names) {
      await page.getByLabel('Player').click();
      await page.getByRole('option', { name }).click();
      await page.getByRole('button', { name: 'Register' }).click();
      await expect(page.getByRole('cell', { name })).toBeVisible({
        timeout: 15_000,
      });
    }

    // Slot assignment takes an *entry* id, which the registration UI does not
    // display, so resolve the ids from the real API (nothing is mocked).
    const categoryId = categoryUrl.split('/').pop() ?? '';
    const entriesResponse = await page.request.get(
      `${API_BASE_URL}/api/v1/categories/${categoryId}/entries`,
    );
    expect(entriesResponse.ok()).toBe(true);
    const body = (await entriesResponse.json()) as {
      data: { id: string; playerId: string | null }[];
    };
    const entries = body.data;
    const entryIds = playerIds.map(
      (playerId) => entries.find((entry) => entry.playerId === playerId)?.id ?? '',
    );
    expect(entryIds.every((id) => id.length > 0)).toBe(true);

    // Create a GROUP stage.
    await page.goto(`${categoryUrl}/stages`);
    await page.getByLabel(/^Name/).fill('Group A');
    await page.getByRole('button', { name: 'Create stage' }).click();

    const stageLink = page.locator('a[href*="/stages/"]');
    await expect(stageLink).toBeVisible();
    await stageLink.click();
    const stageUrl = page.url();

    // Create a match and open it via its own link.
    await page.getByRole('button', { name: 'Create match' }).click();
    const matchLink = page.locator('a[href*="/matches/"]');
    await expect(matchLink).toBeVisible();
    await matchLink.click();

    await expect(page).toHaveURL(/\/matches\//);
    // Assign both participants to slots 1 and 2.
    await page.getByLabel(/^Slot 1 entry ID/).fill(entryIds[0] as string);
    await page.getByRole('button', { name: 'Assign' }).first().click();
    await page.getByLabel(/^Slot 2 entry ID/).fill(entryIds[1] as string);
    await page.getByRole('button', { name: 'Assign' }).nth(1).click();
    await expect(page.getByText(playerOne).first()).toBeVisible({ timeout: 15_000 });

    // Start the match (existing SCHEDULED → IN_PROGRESS transition).
    await page.getByRole('button', { name: 'In Progress' }).click();
    await expect(page.getByText('In progress').first()).toBeVisible();

    // Enter a valid 2-0 result: 21-18, 21-15.
    await page.getByLabel(`Game 1 — ${playerOne} points`).fill('21');
    await page.getByLabel(`Game 1 — ${playerTwo} points`).fill('18');
    await page.getByLabel(`Game 2 — ${playerOne} points`).fill('21');
    await page.getByLabel(`Game 2 — ${playerTwo} points`).fill('15');

    await expect(page.getByTestId('match-winner')).toContainText(playerOne);

    await page.getByRole('button', { name: 'Save & complete result' }).click();

    // The match is completed and the result is shown read-only.
    await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('match-result-winner')).toContainText(playerOne);

    // Standings reflect the completed result: the winner leads on 2 points.
    await page.goto(stageUrl);
    await expect(page.getByRole('heading', { name: 'Standings' })).toBeVisible();
    const standings = page.getByRole('table').filter({ hasText: 'Competitor' });
    const leaderRow = standings.getByRole('row', { name: new RegExp(playerOne) });
    await expect(leaderRow).toContainText('2');
  });
});
