import { expect, test, type APIRequestContext } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * TASK-4 complete tournament progression, against the real UI, API and
 * PostgreSQL.
 *
 * Runs a whole competition - two groups of four, the top two of each qualify,
 * the bracket is generated from the derived qualifiers (never a hand-written
 * order), both semifinals and the final are played and the tournament is
 * completed - and then reloads the app to prove the final state is persisted.
 *
 * Nothing is mocked and no fixture/result row is inserted directly: every
 * mutation goes through the running Fastify API or the web UI. The test drives
 * the browser for the setup and progression UI, and uses the API request
 * context for the repetitive scoring so the spec stays readable; both are the
 * supported interfaces.
 *
 * Requires PostgreSQL and migrations (`docker compose up -d postgres` and
 * `npm run db:migrate`), which the Playwright `webServer` block depends on for
 * the API health check.
 */

interface Entity {
  readonly id: string;
}

interface StageRow extends Entity {
  readonly name: string;
  readonly type: string;
  readonly sequence: number;
}

interface MatchRow extends Entity {
  readonly status: string;
}

interface ParticipantRow {
  readonly entryId: string;
  readonly slot: number;
}

interface BracketMatch {
  readonly matchId: string;
  readonly status: string;
  readonly participant1: { readonly entryId: string | null };
  readonly participant2: { readonly entryId: string | null };
  readonly winnerEntryId: string | null;
}

interface Bracket {
  readonly bracketSize: number;
  readonly complete: boolean;
  readonly status: string;
  readonly rounds: readonly {
    readonly roundNumber: number;
    readonly matches: readonly BracketMatch[];
  }[];
}

interface StandingRow {
  readonly entryId: string;
  readonly position: number;
}

interface QualificationView {
  readonly ready: boolean;
  readonly blockedReason: string | null;
  readonly qualifierCount: number;
  readonly bracketSize: number;
  readonly seeds: readonly string[];
  readonly groups: readonly {
    readonly groupId: string;
    readonly qualifiers: readonly { readonly entryId: string; readonly position: number }[];
  }[];
}

/** Posts JSON and fails fast when the API rejects the request. */
async function post<T>(request: APIRequestContext, url: string, payload?: unknown): Promise<T> {
  const response = await request.post(`${API_BASE_URL}${url}`, {
    ...(payload === undefined ? {} : { data: payload }),
  });
  expect(response.ok(), `POST ${url} -> ${String(response.status())}`).toBe(true);
  return (await response.json()) as T;
}

/** Reads JSON and fails fast when the API rejects the request. */
async function get<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(`${API_BASE_URL}${url}`);
  expect(response.ok(), `GET ${url} -> ${String(response.status())}`).toBe(true);
  return (await response.json()) as T;
}

/** Starts and completes a match so that `winnerEntryId` wins 2-0. */
async function playMatch(
  request: APIRequestContext,
  matchId: string,
  winnerEntryId: string,
): Promise<string> {
  const participants = await get<{ data: readonly ParticipantRow[] }>(
    request,
    `/api/v1/matches/${matchId}/participants`,
  );
  const slot = participants.data.find((row) => row.entryId === winnerEntryId)?.slot ?? 1;
  const winnerPoints = slot === 1 ? [21, 21] : [15, 15];
  const loserPoints = slot === 1 ? [15, 15] : [21, 21];

  await post(request, `/api/v1/matches/${matchId}/transition`, { status: 'IN_PROGRESS' });
  const result = await post<{ data: { winnerEntryId: string } }>(
    request,
    `/api/v1/matches/${matchId}/result`,
    {
      games: [
        { gameNumber: 1, participant1Points: winnerPoints[0], participant2Points: loserPoints[0] },
        { gameNumber: 2, participant1Points: winnerPoints[1], participant2Points: loserPoints[1] },
      ],
    },
  );
  return result.data.winnerEntryId;
}

async function readBracket(request: APIRequestContext, stageId: string): Promise<Bracket> {
  return (await get<{ data: Bracket }>(request, `/api/v1/stages/${stageId}/bracket`)).data;
}

test.describe('tournament progression', () => {
  test('runs group qualification into a knockout bracket and completes the tournament', async ({
    page,
    request,
  }) => {
    const unique = Date.now();
    const tournamentName = `E2E Progression ${unique}`;
    const categoryName = `E2E Progression Singles ${unique}`;
    const categoryCode = `P${String(unique).slice(-4)}`;
    const playerNames = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (n) => `E2E Progress Player ${String(n)} ${unique}`,
    );

    // --- 1. Create the tournament and open registration. --------------------
    const tournament = await post<{ data: Entity }>(request, '/api/v1/tournaments', {
      name: tournamentName,
      startDate: '2026-10-01',
      endDate: '2026-10-05',
      timezone: 'Asia/Kolkata',
    });
    const tournamentId = tournament.data.id;
    await post(request, `/api/v1/tournaments/${tournamentId}/transition`, {
      status: 'REGISTRATION_OPEN',
    });
    await post(request, `/api/v1/tournaments/${tournamentId}/courts`, {
      number: 1,
      name: 'Court 1',
    });

    const category = await post<{ data: Entity }>(
      request,
      `/api/v1/tournaments/${tournamentId}/categories`,
      { name: categoryName, code: categoryCode, format: 'SINGLES' },
    );
    const categoryId = category.data.id;
    await post(request, `/api/v1/categories/${categoryId}/transition`, { status: 'OPEN' });

    // --- 2. Register eight competitors. -------------------------------------
    const entryIds: string[] = [];
    for (const name of playerNames) {
      const player = await post<{ data: Entity }>(request, '/api/v1/players', { name });
      const entry = await post<{ data: Entity }>(
        request,
        `/api/v1/categories/${categoryId}/entries`,
        { playerId: player.data.id },
      );
      await post(request, `/api/v1/entries/${entry.data.id}/confirm`);
      entryIds.push(entry.data.id);
    }
    expect(entryIds).toHaveLength(8);

    // --- 3. Configure the groups in the UI (top two qualify per group). -----
    const categoryUrl = `/tournaments/${tournamentId}/categories/${categoryId}`;
    await page.goto(`${categoryUrl}/stages`);

    await page.getByLabel(/^Name/).fill('Group A');
    await page.getByLabel(/^Sequence/).fill('1');
    await page.getByLabel('Qualifiers per group').fill('2');
    await page.getByRole('button', { name: 'Create stage' }).click();
    await expect(page.getByRole('row', { name: /Group A/ })).toBeVisible();

    await page.getByLabel(/^Name/).fill('Group B');
    await page.getByLabel(/^Sequence/).fill('2');
    await page.getByLabel('Qualifiers per group').fill('2');
    await page.getByRole('button', { name: 'Create stage' }).click();
    await expect(page.getByRole('row', { name: /Group B/ })).toBeVisible();

    // The knockout stage is created without a draw size; generation derives it.
    await page.getByLabel(/^Name/).fill('Knockout');
    await page.getByLabel('Type').click();
    await page.getByRole('option', { name: 'Knockout' }).click();
    await page.getByLabel(/^Sequence/).fill('3');
    await page.getByRole('button', { name: 'Create stage' }).click();
    await expect(page.getByRole('row', { name: /Knockout/ })).toBeVisible();

    // The qualifier count is shown in the stage list (configuration is visible).
    const groupARow = page.getByRole('row', { name: /Group A/ });
    await expect(groupARow).toContainText('2');

    const stages = await get<{ data: readonly StageRow[] }>(
      request,
      `/api/v1/categories/${categoryId}/stages`,
    );
    const stageIdByName = (name: string): string => {
      const stage = stages.data.find((candidate) => candidate.name === name);
      if (!stage) {
        throw new Error(`Expected a stage named ${name}.`);
      }
      return stage.id;
    };
    const groupA = stageIdByName('Group A');
    const groupB = stageIdByName('Group B');
    const knockout = stageIdByName('Knockout');

    // Activate the knockout stage so its matches can be played.
    await post(request, `/api/v1/stages/${knockout}/transition`, { status: 'ACTIVE' });

    // --- 4 & 5. Generate the group round-robins; four competitors = six. ----
    const generateFixtures = async (stageId: string, names: readonly string[]): Promise<void> => {
      await page.goto(`${categoryUrl}/stages/${stageId}`);
      await expect(page.getByText('No matches yet')).toBeVisible();
      for (const name of names) {
        await page.getByRole('checkbox', { name: new RegExp(name) }).check();
      }
      await expect(page.getByTestId('group-fixture-shape')).toContainText('6 matches');
      await page.getByRole('button', { name: 'Generate fixtures' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Generate fixtures' }).click();
      await expect(page.locator('a[href*="/matches/"]')).toHaveCount(6, { timeout: 15_000 });
    };

    await generateFixtures(groupA, playerNames.slice(0, 4));
    await generateFixtures(groupB, playerNames.slice(4, 8));

    const matchesFor = async (stageId: string): Promise<readonly MatchRow[]> =>
      (await get<{ data: readonly MatchRow[] }>(request, `/api/v1/stages/${stageId}/matches`)).data;
    expect(await matchesFor(groupA)).toHaveLength(6);
    expect(await matchesFor(groupB)).toHaveLength(6);

    // --- Qualification is blocked while the groups are incomplete. ----------
    await page.goto(`${categoryUrl}/stages/${knockout}`);
    await expect(page.getByTestId('qualification-blocked')).toContainText(
      'Every group match must be completed',
    );
    await expect(
      page.getByRole('button', { name: 'Generate bracket from qualifiers' }),
    ).toBeDisabled();

    const prematureGenerate = await request.post(
      `${API_BASE_URL}/api/v1/stages/${knockout}/bracket/generate`,
    );
    expect(prematureGenerate.status()).toBe(422);

    // --- 6 & 7. Schedule and complete every group match. --------------------
    const courtId = (
      await get<{ data: readonly Entity[] }>(request, `/api/v1/tournaments/${tournamentId}/courts`)
    ).data[0]?.id;
    expect(courtId).toBeDefined();

    // Schedule the first group match on Court 1 to prove scheduling works with
    // generated fixtures; the rest are played without a court for brevity.
    const firstGroupMatch = (await matchesFor(groupA))[0];
    if (!firstGroupMatch) {
      throw new Error('Expected at least one group fixture.');
    }
    const schedule = await request.post(
      `${API_BASE_URL}/api/v1/matches/${firstGroupMatch.id}/schedule`,
      {
        data: {
          courtId,
          scheduledStartAt: '2026-10-05T10:00:00.000Z',
          scheduledEndAt: '2026-10-05T10:30:00.000Z',
        },
      },
    );
    expect(schedule.ok()).toBe(true);

    // The conflict constraint rejects an overlapping match on the same court.
    const secondGroupMatch = (await matchesFor(groupA))[1];
    if (!secondGroupMatch) {
      throw new Error('Expected a second group fixture.');
    }
    const conflict = await request.post(
      `${API_BASE_URL}/api/v1/matches/${secondGroupMatch.id}/schedule`,
      {
        data: {
          courtId,
          scheduledStartAt: '2026-10-05T10:15:00.000Z',
          scheduledEndAt: '2026-10-05T10:45:00.000Z',
        },
      },
    );
    expect(conflict.status()).toBe(409);

    // Complete every group match; slot 1 always wins so the draw is deterministic.
    const completeGroup = async (stageId: string): Promise<void> => {
      for (const match of await matchesFor(stageId)) {
        const participants = await get<{ data: readonly ParticipantRow[] }>(
          request,
          `/api/v1/matches/${match.id}/participants`,
        );
        const winner = participants.data.find((row) => row.slot === 1)?.entryId ?? '';
        await playMatch(request, match.id, winner);
      }
    };
    await completeGroup(groupA);
    await completeGroup(groupB);

    // --- 8. Standings are correct and complete after the refresh. -----------
    const standings = async (stageId: string): Promise<readonly StandingRow[]> =>
      (await get<{ data: readonly StandingRow[] }>(request, `/api/v1/stages/${stageId}/standings`))
        .data;

    await page.goto(`${categoryUrl}/stages/${groupA}`);
    await expect(page.getByRole('heading', { name: 'Standings' })).toBeVisible();
    // Phase 5 behaviour: the table lists every active entry of the category
    // (eight competitors), even though only four play in this group.
    const standingsTable = page.getByRole('table').filter({ hasText: 'Competitor' });
    await expect(standingsTable.getByRole('row')).toHaveCount(9); // header + eight

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Standings' })).toBeVisible();
    await expect(standingsTable.getByRole('row')).toHaveCount(9);

    // --- 9. Qualification is derived from the standings, not hard-coded. ----
    const view = (
      await get<{ data: QualificationView }>(request, `/api/v1/stages/${knockout}/qualification`)
    ).data;
    expect(view.ready).toBe(true);
    expect(view.qualifierCount).toBe(4);
    expect(view.bracketSize).toBe(4);
    expect(view.groups).toHaveLength(2);

    // Each group's qualifiers are exactly the top two of its own standings -
    // no sibling-group entry can qualify from here.
    for (const group of view.groups) {
      const groupStandings = (await standings(group.groupId)).slice(0, 2);
      expect(group.qualifiers.map((row) => row.entryId)).toEqual(
        groupStandings.map((row) => row.entryId),
      );
    }

    // The qualification UI shows the qualifiers and generates without UUID entry.
    await page.goto(`${categoryUrl}/stages/${knockout}`);
    await expect(page.getByText('Group qualification')).toBeVisible();
    await expect(page.getByTestId('qualification-summary')).toContainText('4 qualifiers');
    await page.getByRole('button', { name: 'Generate bracket from qualifiers' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Generate bracket' }).click();

    await expect(page.getByText(/4-entry bracket/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Semifinals' })).toBeVisible();

    // --- 10. Bracket participants are the qualified competitors. ------------
    const bracket = await readBracket(request, knockout);
    expect(bracket.bracketSize).toBe(4);
    const semifinals = bracket.rounds.find((round) => round.roundNumber === 1)?.matches ?? [];
    expect(semifinals).toHaveLength(2);
    for (const semi of semifinals) {
      expect(view.seeds).toContain(semi.participant1.entryId);
      expect(view.seeds).toContain(semi.participant2.entryId);
    }

    // A second generation is rejected - no duplicate bracket.
    const duplicate = await request.post(
      `${API_BASE_URL}/api/v1/stages/${knockout}/bracket/generate`,
    );
    expect(duplicate.status()).toBe(409);

    // --- 11 & 12. Play the semifinals; the final populates. -----------------
    const semi1 = semifinals[0];
    const semi2 = semifinals[1];
    if (!semi1 || !semi2) {
      throw new Error('Expected two semifinals.');
    }
    const semi1Winner = await playMatch(request, semi1.matchId, semi1.participant1.entryId ?? '');
    const semi2Winner = await playMatch(request, semi2.matchId, semi2.participant1.entryId ?? '');

    const afterSemis = await readBracket(request, knockout);
    const final = afterSemis.rounds.find((round) => round.roundNumber === 2)?.matches[0];
    if (!final) {
      throw new Error('Expected the final to be populated.');
    }
    // --- 13. The final holds exactly the two semifinal winners. -------------
    expect(final.participant1.entryId).toBe(semi1Winner);
    expect(final.participant2.entryId).toBe(semi2Winner);
    expect(afterSemis.complete).toBe(false);

    // --- 14 & 15. Play the final; the champion is decided. ------------------
    const champion = await playMatch(request, final.matchId, final.participant1.entryId ?? '');
    expect([semi1Winner, semi2Winner]).toContain(champion);

    const completedBracket = await readBracket(request, knockout);
    expect(completedBracket.complete).toBe(true);
    expect(completedBracket.status).toBe('COMPLETED');

    // --- 16 & 17. Refresh; every final state remains persisted. -------------
    await page.reload();
    await expect(page.getByText(/champion decided/)).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: 'Generate bracket from qualifiers' }),
    ).toHaveCount(0);

    const persistedBracket = await readBracket(request, knockout);
    expect(persistedBracket.complete).toBe(true);
    const persistedFinal = persistedBracket.rounds.find((round) => round.roundNumber === 2)
      ?.matches[0];
    expect(persistedFinal?.winnerEntryId).toBe(champion);

    // The tournament itself can now be completed through the UI: registration
    // is closed, the tournament is put in progress and then completed.
    await page.goto(`/tournaments/${tournamentId}`);
    await page.getByRole('button', { name: 'Registration Closed', exact: true }).click();
    await expect(page.getByText('Registration closed').first()).toBeVisible();

    await page.getByRole('button', { name: 'In Progress', exact: true }).click();
    await expect(page.getByText('In progress').first()).toBeVisible();

    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Completed' }).click();
    await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 15_000 });

    const finalTournament = await get<{ data: { status: string } }>(
      request,
      `/api/v1/tournaments/${tournamentId}`,
    );
    expect(finalTournament.data.status).toBe('COMPLETED');
  });
});
