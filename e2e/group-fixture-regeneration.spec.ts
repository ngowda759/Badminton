import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

interface Entity {
  readonly id: string;
}

interface StandingRow {
  readonly entryId: string;
  readonly played: number;
  readonly points: number;
  readonly pointsFor: number;
}

/**
 * Guarded group-fixture regeneration (TASK-12 / gap G15), against the real UI,
 * API and PostgreSQL.
 *
 * Creates a four-entry GROUP round-robin, records one result so a match is
 * COMPLETED and the standings show points, then regenerates through the UI with
 * the same four entries in a different order. The match list is replaced (the
 * previously completed match id is gone and no match is COMPLETED), the
 * standings reset to zero played and the new round-robin is present after a
 * reload. Nothing is mocked: every step goes through the running Fastify API and
 * the database.
 *
 * Requires PostgreSQL and migrations (`docker compose up -d postgres` and
 * `npm run db:migrate`), which the Playwright `webServer` block depends on for
 * the API health check.
 */

/** Posts JSON and asserts success, returning the `{ data }` payload. */
async function post<T>(request: APIRequestContext, url: string, payload: unknown): Promise<T> {
  const response = await request.post(`${API_BASE_URL}${url}`, { data: payload });
  expect(response.ok(), `${url} -> ${String(response.status())}`).toBe(true);
  return ((await response.json()) as { data: T }).data;
}

async function get<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(`${API_BASE_URL}${url}`);
  expect(response.ok(), `${url} -> ${String(response.status())}`).toBe(true);
  return ((await response.json()) as { data: T }).data;
}

/** Creates an open tournament, category and four active player entries. */
async function setupGroup(
  request: APIRequestContext,
  unique: number,
): Promise<{
  readonly tournamentId: string;
  readonly categoryId: string;
  readonly stageId: string;
  readonly entryIds: readonly string[];
  readonly names: readonly string[];
}> {
  const tournament = await post<Entity>(request, '/api/v1/tournaments', {
    name: `E2E Regen ${unique}`,
    startDate: '2026-10-01',
    endDate: '2026-10-05',
    timezone: 'Asia/Kolkata',
  });
  await post(request, `/api/v1/tournaments/${tournament.id}/transition`, {
    status: 'REGISTRATION_OPEN',
  });
  const category = await post<Entity>(request, `/api/v1/tournaments/${tournament.id}/categories`, {
    name: `E2E Regen Cat ${unique}`,
    code: `R${String(unique).slice(-4)}`,
    format: 'SINGLES',
  });
  await post(request, `/api/v1/categories/${category.id}/transition`, { status: 'OPEN' });

  const names: string[] = [];
  const entryIds: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const name = `E2E Regen P${String(index + 1)} ${unique}`;
    names.push(name);
    const player = await post<Entity>(request, '/api/v1/players', { name });
    const entry = await post<Entity>(request, `/api/v1/categories/${category.id}/entries`, {
      playerId: player.id,
    });
    entryIds.push(entry.id);
  }

  const stage = await post<Entity>(request, `/api/v1/categories/${category.id}/stages`, {
    name: 'Group A',
    type: 'GROUP',
    sequence: 1,
  });

  return {
    tournamentId: tournament.id,
    categoryId: category.id,
    stageId: stage.id,
    entryIds,
    names,
  };
}

/**
 * Completes a generated match: the round-robin already filled both participant
 * slots, so only the transition and the single-game result are recorded.
 */
async function completeMatch(request: APIRequestContext, matchId: string): Promise<void> {
  await post(request, `/api/v1/matches/${matchId}/transition`, { status: 'IN_PROGRESS' });
  await post(request, `/api/v1/matches/${matchId}/result`, {
    games: [{ gameNumber: 1, participant1Points: 21, participant2Points: 10 }],
  });
}

async function matchIdsOf(page: Page, stageId: string): Promise<readonly Entity[]> {
  const response = await page.request.get(`${API_BASE_URL}/api/v1/stages/${stageId}/matches`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: readonly Entity[] }).data;
}

test.describe('group fixture regeneration', () => {
  test('replaces the fixtures, discards results and resets the standings', async ({
    page,
    request,
  }) => {
    const unique = Date.now();
    const { tournamentId, categoryId, stageId, entryIds, names } = await setupGroup(
      request,
      unique,
    );

    // Generate the round-robin over the API for a deterministic starting point.
    await post(request, `/api/v1/stages/${stageId}/fixtures`, { entryIds });
    const generated = await matchIdsOf(page, stageId);
    expect(generated).toHaveLength(6);

    // Complete one match so the standings show points.
    const firstMatch = generated[0];
    if (!firstMatch) {
      throw new Error('Expected a generated match.');
    }
    await completeMatch(request, firstMatch.id);

    let standings = await get<readonly StandingRow[]>(
      request,
      `/api/v1/stages/${stageId}/standings`,
    );
    expect(standings.some((row) => row.played > 0 && row.points > 0)).toBe(true);

    // Open the stage page: fixtures exist, so regeneration is offered.
    const categoryUrl = `/tournaments/${tournamentId}/categories/${categoryId}`;
    await page.goto(`${categoryUrl}/stages/${stageId}`);
    await expect(
      page.getByRole('button', { name: 'Regenerate fixtures', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Generate fixtures', exact: true })).toHaveCount(
      0,
    );

    // Regenerate with the same four entries in a different order.
    await page.getByRole('button', { name: 'Regenerate fixtures', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Select all four entries in a different order than the original: the
    // `reordered` list drives the checkbox clicks, and toggling appends to the
    // round-robin ordering, so a reversed selection is a reversed schedule.
    const reordered = [...entryIds].reverse();
    for (const entryId of reordered) {
      const index = entryIds.indexOf(entryId);
      await dialog.getByRole('checkbox', { name: new RegExp(names[index] ?? '') }).check();
    }

    await dialog.getByRole('button', { name: 'Regenerate fixtures', exact: true }).click();

    // The confirmation closes and the match list is replaced.
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('a[href*="/matches/"]')).toHaveCount(6, { timeout: 15_000 });

    const replaced = await matchIdsOf(page, stageId);
    expect(replaced).toHaveLength(6);
    const replacedIds = replaced.map((match) => match.id);
    expect(replacedIds).not.toContain(firstMatch.id);

    // No match is COMPLETED and the standings are reset to zero played.
    const matches = await get<readonly { id: string; status: string }[]>(
      request,
      `/api/v1/stages/${stageId}/matches`,
    );
    expect(matches.every((match) => match.status !== 'COMPLETED')).toBe(true);

    standings = await get<readonly StandingRow[]>(request, `/api/v1/stages/${stageId}/standings`);
    expect(standings.every((row) => row.played === 0)).toBe(true);
    expect(standings.every((row) => row.points === 0)).toBe(true);

    // The new round-robin survives a reload.
    await page.reload();
    await expect(page.locator('a[href*="/matches/"]')).toHaveCount(6, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Regenerate fixtures' })).toBeVisible();
  });

  test('refuses regeneration of a stage with no fixtures', async ({ request }) => {
    const unique = Date.now();
    const { stageId, entryIds } = await setupGroup(request, unique);

    const response = await request.post(
      `${API_BASE_URL}/api/v1/stages/${stageId}/fixtures/regenerate`,
      { data: { entryIds } },
    );
    expect(response.status()).toBe(409);
  });
});
