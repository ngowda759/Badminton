import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * TASK-8 / TASK-9 result correction, against the real UI, API and PostgreSQL.
 *
 * A completed group match is scored 21-10 over the API, then corrected to 21-19
 * through the match-detail UI: the match stays COMPLETED, the result summary
 * shows the corrected score and the derived standings reflect the corrected
 * points and point difference. A completed knockout bracket (four entries, both
 * semifinals and the final played) is corrected through the UI: the corrected
 * semifinal stays COMPLETED with the new winner, the final's slot 1 is re-filled
 * with that winner and the final's stale result is reset. Nothing is mocked:
 * every step goes through the running Fastify API and the database.
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

/**
 * Creates an open tournament, category, four entries and a completed 4-entry
 * knockout bracket (both semifinals and the final played).
 *
 * Returns the semifinal 1 match (whose correction re-derives the bracket), the
 * final match and the competitor names/entries so the test can assert the final
 * slot 1 was re-filled and the final was reset.
 */
async function setupCompletedKnockoutBracket(
  request: APIRequestContext,
  unique: number,
): Promise<{
  tournamentId: string;
  categoryId: string;
  semi1Id: string;
  finalId: string;
  names: readonly [string, string, string, string];
  entryIds: readonly [string, string, string, string];
}> {
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

  const names = [
    `E2E KO A ${unique}`,
    `E2E KO B ${unique}`,
    `E2E KO C ${unique}`,
    `E2E KO D ${unique}`,
  ] as const;
  const entryIds: string[] = [];
  for (const name of names) {
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
  await post(request, `/api/v1/stages/${stage.id}/bracket`, { entryIds });
  await post(request, `/api/v1/stages/${stage.id}/transition`, { status: 'ACTIVE' });

  const bracket = await request.get(`${API_BASE_URL}/api/v1/stages/${stage.id}/bracket`);
  const bracketBody = (await bracket.json()) as {
    data: {
      rounds: readonly { roundNumber: number; matches: readonly { matchId: string }[] }[];
    };
  };
  const round1 = bracketBody.data.rounds.find((round) => round.roundNumber === 1);
  const round2 = bracketBody.data.rounds.find((round) => round.roundNumber === 2);
  const semi1Id = round1?.matches[0]?.matchId ?? '';
  const semi2Id = round1?.matches[1]?.matchId ?? '';
  const finalId = round2?.matches[0]?.matchId ?? '';
  expect(semi1Id.length).toBeGreaterThan(0);
  expect(finalId.length).toBeGreaterThan(0);

  const twoZero = [
    { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
    { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
  ];
  for (const matchId of [semi1Id, semi2Id, finalId]) {
    await post(request, `/api/v1/matches/${matchId}/transition`, { status: 'IN_PROGRESS' });
    await post(request, `/api/v1/matches/${matchId}/result`, { games: twoZero });
  }

  return {
    tournamentId: tournament.id,
    categoryId: category.id,
    semi1Id,
    finalId,
    names,
    entryIds: [
      entryIds[0] as string,
      entryIds[1] as string,
      entryIds[2] as string,
      entryIds[3] as string,
    ],
  };
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

  test('corrects a completed knockout semifinal, re-fills the final and resets it', async ({
    page,
    request,
  }) => {
    const unique = Date.now();
    const { tournamentId, categoryId, semi1Id, finalId, names, entryIds } =
      await setupCompletedKnockoutBracket(request, unique);

    // Which competitors are in semifinal 1, and which slot won (slot 1).
    const participantsResponse = await request.get(
      `${API_BASE_URL}/api/v1/matches/${semi1Id}/participants`,
    );
    const participants = (
      (await participantsResponse.json()) as {
        data: readonly { slot: number; entryId: string }[];
      }
    ).data;
    const slot1Entry = participants.find((row) => row.slot === 1)?.entryId ?? '';
    const slot2Entry = participants.find((row) => row.slot === 2)?.entryId ?? '';
    const nameFor = (entryId: string): string => names[entryIds.indexOf(entryId)] ?? '';
    const slot1Name = nameFor(slot1Entry);
    const slot2Name = nameFor(slot2Entry);

    // The final's slot 1 holds the semifinal 1 winner (slot 1).
    const finalBefore = await request.get(`${API_BASE_URL}/api/v1/matches/${finalId}/participants`);
    expect(
      (
        (await finalBefore.json()) as { data: readonly { slot: number; entryId: string }[] }
      ).data.find((row) => row.slot === 1)?.entryId,
    ).toBe(slot1Entry);

    await openMatch(page, tournamentId, categoryId, semi1Id);

    // The semifinal is COMPLETED with a correction control.
    await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Correct result' })).toBeVisible();

    await page.getByRole('button', { name: 'Correct result' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Correct result' }).click();

    // Correct so the other competitor wins: slot 2 takes both games.
    const game1Slot1 = page.getByLabel(`Game 1 — ${slot1Name} points`);
    const game1Slot2 = page.getByLabel(`Game 1 — ${slot2Name} points`);
    await game1Slot1.fill('15');
    await game1Slot2.fill('21');
    await page.getByLabel(`Game 2 — ${slot1Name} points`).fill('18');
    await page.getByLabel(`Game 2 — ${slot2Name} points`).fill('21');
    await page.getByRole('button', { name: 'Save correction' }).click();

    // The semifinal stays COMPLETED with the new winner.
    await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('match-result-winner')).toContainText(slot2Name);

    // The final's slot 1 now holds the new winner...
    const finalAfter = await request.get(`${API_BASE_URL}/api/v1/matches/${finalId}/participants`);
    expect(
      (
        (await finalAfter.json()) as { data: readonly { slot: number; entryId: string }[] }
      ).data.find((row) => row.slot === 1)?.entryId,
    ).toBe(slot2Entry);

    // ...and the final's stale result was reset.
    const finalResult = await request.get(`${API_BASE_URL}/api/v1/matches/${finalId}/result`);
    expect(((await finalResult.json()) as { data: unknown }).data).toBeNull();
  });
});
