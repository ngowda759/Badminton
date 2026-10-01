import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * TASK-8 result correction, against the real UI, API and PostgreSQL.
 *
 * A completed group match is scored 21-10 over the API, then corrected to 21-19
 * through the match-detail UI: the match stays COMPLETED, the result summary
 * shows the corrected score and the derived standings reflect the corrected
 * points and point difference. A completed knockout match is shown read-only
 * with no correction control, because correcting it would require re-deriving
 * the bracket. Nothing is mocked: every step goes through the running Fastify
 * API and the database.
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
  readonly points: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly pointDifference: number;
}

/** Posts JSON and asserts success, returning the `{ data }` payload. */
async function post<T>(request: APIRequestContext, url: string, payload: unknown): Promise<T> {
  const response = await request.post(`${API_BASE_URL}${url}`, { data: payload });
  expect(response.ok(), `${url} -> ${String(response.status())}`).toBe(true);
  return ((await response.json()) as { data: T }).data;
}

/** Creates an open tournament, category, two entries and a GROUP match. */
async function setupGroupMatch(
  request: APIRequestContext,
  unique: number,
): Promise<{
  tournamentId: string;
  categoryId: string;
  stageId: string;
  matchId: string;
  names: readonly [string, string];
  entryIds: readonly [string, string];
}> {
  const tournament = await post<Entity>(request, '/api/v1/tournaments', {
    name: `E2E Correction ${unique}`,
    startDate: '2026-10-01',
    endDate: '2026-10-05',
    timezone: 'Asia/Kolkata',
  });
  await post(request, `/api/v1/tournaments/${tournament.id}/transition`, {
    status: 'REGISTRATION_OPEN',
  });
  const category = await post<Entity>(request, `/api/v1/tournaments/${tournament.id}/categories`, {
    name: `E2E Correction Cat ${unique}`,
    code: `C${String(unique).slice(-4)}`,
    format: 'SINGLES',
  });
  await post(request, `/api/v1/categories/${category.id}/transition`, { status: 'OPEN' });

  const names = [`E2E Corr Alice ${unique}`, `E2E Corr Bob ${unique}`] as const;
  const entryIds: string[] = [];
  for (const name of names) {
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
  const match = await post<Entity>(request, `/api/v1/stages/${stage.id}/matches`, { sequence: 1 });
  await post(request, `/api/v1/matches/${match.id}/participants`, {
    entryId: entryIds[0],
    slot: 1,
  });
  await post(request, `/api/v1/matches/${match.id}/participants`, {
    entryId: entryIds[1],
    slot: 2,
  });
  await post(request, `/api/v1/matches/${match.id}/transition`, { status: 'IN_PROGRESS' });

  return {
    tournamentId: tournament.id,
    categoryId: category.id,
    stageId: stage.id,
    matchId: match.id,
    names,
    entryIds: [entryIds[0] as string, entryIds[1] as string],
  };
}

/** Creates an open tournament, category, two entries and a completed knockout final. */
async function setupCompletedKnockout(
  request: APIRequestContext,
  unique: number,
): Promise<{ matchId: string; tournamentId: string; categoryId: string }> {
  const tournament = await post<Entity>(request, '/api/v1/tournaments', {
    name: `E2E KO Correction ${unique}`,
    startDate: '2026-10-01',
    endDate: '2026-10-05',
    timezone: 'Asia/Kolkata',
  });
  await post(request, `/api/v1/tournaments/${tournament.id}/transition`, {
    status: 'REGISTRATION_OPEN',
  });
  const category = await post<Entity>(request, `/api/v1/tournaments/${tournament.id}/categories`, {
    name: `E2E KO Cat ${unique}`,
    code: `K${String(unique).slice(-4)}`,
    format: 'SINGLES',
  });
  await post(request, `/api/v1/categories/${category.id}/transition`, { status: 'OPEN' });

  const entryIds: string[] = [];
  for (const name of [`E2E KO Alice ${unique}`, `E2E KO Bob ${unique}`]) {
    const player = await post<Entity>(request, '/api/v1/players', { name });
    const entry = await post<Entity>(request, `/api/v1/categories/${category.id}/entries`, {
      playerId: player.id,
    });
    entryIds.push(entry.id);
  }

  const stage = await post<Entity>(request, `/api/v1/categories/${category.id}/stages`, {
    name: 'Knockout',
    type: 'KNOCKOUT',
    sequence: 1,
  });
  await post(request, `/api/v1/stages/${stage.id}/bracket`, {
    entryIds: [entryIds[0], entryIds[1]],
  });
  await post(request, `/api/v1/stages/${stage.id}/transition`, { status: 'ACTIVE' });

  const bracket = await request.get(`${API_BASE_URL}/api/v1/stages/${stage.id}/bracket`);
  const bracketBody = (await bracket.json()) as {
    data: { rounds: readonly { matches: readonly { matchId: string }[] }[] };
  };
  const matchId = bracketBody.data.rounds[0]?.matches[0]?.matchId ?? '';
  expect(matchId.length).toBeGreaterThan(0);

  await post(request, `/api/v1/matches/${matchId}/transition`, { status: 'IN_PROGRESS' });
  await post(request, `/api/v1/matches/${matchId}/result`, {
    games: [
      { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
      { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
    ],
  });

  return { matchId, tournamentId: tournament.id, categoryId: category.id };
}

/** Opens the match-detail page for a match within its category. */
async function openMatch(
  page: Page,
  tournamentId: string,
  categoryId: string,
  matchId: string,
): Promise<void> {
  await page.goto(`/tournaments/${tournamentId}/categories/${categoryId}/matches/${matchId}`);
}

test.describe('result correction', () => {
  test('corrects a completed group result and reflects it in the standings', async ({
    page,
    request,
  }) => {
    const unique = Date.now();
    const { tournamentId, categoryId, stageId, matchId, names, entryIds } = await setupGroupMatch(
      request,
      unique,
    );
    const [alice, bob] = names;

    // The original 21-10 result.
    await post(request, `/api/v1/matches/${matchId}/result`, {
      games: [{ gameNumber: 1, participant1Points: 21, participant2Points: 10 }],
    });

    await openMatch(page, tournamentId, categoryId, matchId);

    // The original result is shown, with the correction control.
    await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('match-result-winner')).toContainText(alice);
    await expect(page.getByTestId('result-game-1')).toContainText('21 – 10');

    await page.getByRole('button', { name: 'Correct result' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Correct result' }).click();

    // The form is pre-filled from the stored result; correct 21-10 to 21-19.
    const slot1 = page.getByLabel(`Game — ${alice} points`);
    await expect(slot1).toHaveValue('21');
    await page.getByLabel(`Game — ${bob} points`).fill('19');
    await expect(page.getByTestId('match-winner')).toContainText(alice);
    await page.getByRole('button', { name: 'Save correction' }).click();

    // The match stays COMPLETED and shows the corrected score.
    await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-game-1')).toContainText('21 – 19');

    // The stored result and the derived standings reflect the correction.
    const standingsResponse = await request.get(
      `${API_BASE_URL}/api/v1/stages/${stageId}/standings`,
    );
    const standings = ((await standingsResponse.json()) as { data: readonly StandingRow[] }).data;
    const winner = standings.find((row) => row.entryId === entryIds[0]);
    const loser = standings.find((row) => row.entryId === entryIds[1]);
    expect(winner).toMatchObject({
      points: 2,
      pointsFor: 21,
      pointsAgainst: 19,
      pointDifference: 2,
    });
    expect(loser).toMatchObject({
      points: 0,
      pointsFor: 19,
      pointsAgainst: 21,
      pointDifference: -2,
    });
  });

  test('a completed knockout match exposes no correction control', async ({ page, request }) => {
    const unique = Date.now();
    const { matchId, tournamentId, categoryId } = await setupCompletedKnockout(request, unique);

    await openMatch(page, tournamentId, categoryId, matchId);

    // The result is shown read-only: no correction control for a knockout match.
    await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('match-result-summary')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Correct result' })).toHaveCount(0);
    await expect(
      page.getByText('The winner has advanced to the next knockout round.'),
    ).toBeVisible();
  });
});
