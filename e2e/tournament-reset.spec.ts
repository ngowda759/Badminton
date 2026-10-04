import { readFileSync } from 'node:fs';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * TASK-13 / G9 tournament backup export and reset, against the real UI, API and
 * PostgreSQL.
 *
 * A registration-open tournament with a category, a GROUP stage and a 2-entry
 * round-robin is played (one group result recorded, so the standings show
 * points). The backup is downloaded through the tournament-details UI and its
 * JSON is asserted to carry the tournament and its matches. The tournament is
 * then reset through the UI: the match list shows no completed match, the
 * standings are back to zero played and the stage is PENDING after a reload.
 * Nothing is mocked: every step goes through the running Fastify API and the
 * database.
 *
 * Requires PostgreSQL and migrations (`docker compose up -d postgres` and
 * `npm run db:migrate`), which the Playwright `webServer` block depends on for
 * the API health check.
 */

interface Entity {
  readonly id: string;
}

interface StandingRow {
  readonly entryId: string;
  readonly played: number;
  readonly points: number;
}

interface MatchRow {
  readonly id: string;
  readonly status: string;
  readonly winnerEntryId: string | null;
}

interface BackupPayload {
  readonly tournament: { readonly id: string };
  readonly matches: readonly { readonly id: string }[];
}

/** Posts JSON and asserts success, returning the `{ data }` payload. */
async function post<T>(request: APIRequestContext, url: string, payload: unknown): Promise<T> {
  const response = await request.post(`${API_BASE_URL}${url}`, { data: payload });
  expect(response.ok(), `${url} -> ${String(response.status())}`).toBe(true);
  return ((await response.json()) as { data: T }).data;
}

/** Gets JSON and asserts success, returning the `{ data }` payload. */
async function get<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(`${API_BASE_URL}${url}`);
  expect(response.ok(), `${url} -> ${String(response.status())}`).toBe(true);
  return ((await response.json()) as { data: T }).data;
}

/** Creates a played tournament: category, GROUP stage, 2-entry round-robin, one result. */
async function setupPlayedTournament(
  request: APIRequestContext,
  unique: number,
): Promise<{ tournamentId: string; categoryId: string; stageId: string; matchId: string }> {
  const tournament = await post<Entity>(request, '/api/v1/tournaments', {
    name: `E2E Backup ${unique}`,
    startDate: '2026-10-01',
    endDate: '2026-10-05',
    timezone: 'Asia/Kolkata',
  });
  await post(request, `/api/v1/tournaments/${tournament.id}/transition`, {
    status: 'REGISTRATION_OPEN',
  });
  const category = await post<Entity>(request, `/api/v1/tournaments/${tournament.id}/categories`, {
    name: `E2E Backup Cat ${unique}`,
    code: `B${String(unique).slice(-4)}`,
    format: 'SINGLES',
  });
  await post(request, `/api/v1/categories/${category.id}/transition`, { status: 'OPEN' });

  const entryIds: string[] = [];
  for (const name of [`E2E Backup Alice ${unique}`, `E2E Backup Bob ${unique}`]) {
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
  // The 2-entry round-robin is exactly one match, generated from the entries.
  await post(request, `/api/v1/stages/${stage.id}/fixtures`, { entryIds });
  const matches = await get<readonly MatchRow[]>(request, `/api/v1/stages/${stage.id}/matches`);
  const matchId = matches[0]?.id ?? '';
  expect(matchId.length).toBeGreaterThan(0);

  await post(request, `/api/v1/stages/${stage.id}/transition`, { status: 'ACTIVE' });
  await post(request, `/api/v1/matches/${matchId}/transition`, { status: 'IN_PROGRESS' });
  await post(request, `/api/v1/matches/${matchId}/result`, {
    games: [{ gameNumber: 1, participant1Points: 21, participant2Points: 15 }],
  });

  return { tournamentId: tournament.id, categoryId: category.id, stageId: stage.id, matchId };
}

/** Opens the tournament-details page. */
async function openTournament(page: Page, tournamentId: string): Promise<void> {
  await page.goto(`/tournaments/${tournamentId}`);
  await expect(page.getByRole('button', { name: 'Reset tournament' })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('tournament backup export and reset', () => {
  test('backs up a played tournament and resets it', async ({ page, request }) => {
    const unique = Date.now();
    const { tournamentId, stageId, matchId } = await setupPlayedTournament(request, unique);

    // The played match contributes points to the standings.
    const standingsBefore = await get<readonly StandingRow[]>(
      request,
      `/api/v1/stages/${stageId}/standings`,
    );
    expect(standingsBefore.some((row) => row.played > 0 && row.points > 0)).toBe(true);

    await openTournament(page, tournamentId);

    // Export the backup through the UI and read the downloaded JSON.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export backup' }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    const backup = JSON.parse(readFileSync(path, 'utf8')) as BackupPayload;
    expect(backup.tournament.id).toBe(tournamentId);
    expect(backup.matches.map((match) => match.id)).toContain(matchId);

    // Reset the tournament through the UI, confirming the destructive action.
    await page.getByRole('button', { name: 'Reset tournament' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Reset tournament' }).click();

    // The match list shows no completed match and no winner.
    await expect
      .poll(async () => {
        const matches = await get<readonly MatchRow[]>(
          request,
          `/api/v1/stages/${stageId}/matches`,
        );
        return matches.map((match) => `${match.status}:${String(match.winnerEntryId)}`).join(',');
      })
      .toBe('SCHEDULED:null');

    // The standings are back to zero played.
    const standingsAfter = await get<readonly StandingRow[]>(
      request,
      `/api/v1/stages/${stageId}/standings`,
    );
    expect(standingsAfter.every((row) => row.played === 0 && row.points === 0)).toBe(true);

    // The stage is PENDING after a reload.
    await page.reload();
    const stage = await get<{ readonly status: string }>(request, `/api/v1/stages/${stageId}`);
    expect(stage.status).toBe('PENDING');
  });
});
