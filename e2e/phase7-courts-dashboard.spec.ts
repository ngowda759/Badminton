import { expect, test, type APIRequestContext } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

interface Entity {
  readonly id: string;
}

interface BracketMatch {
  readonly matchId: string;
  readonly participant1: { readonly entryId: string | null };
  readonly participant2: { readonly entryId: string | null };
}

interface Bracket {
  readonly complete: boolean;
  readonly status: string;
  readonly rounds: readonly {
    readonly roundNumber: number;
    readonly matches: readonly BracketMatch[];
  }[];
}

/**
 * Phase 7 operational flow, against the real UI, API and PostgreSQL.
 *
 * Creates a tournament, category, two players/entries, a court and a GROUP
 * match; schedules the match on the court; opens the court board and the
 * dashboard; starts and scores the match; then confirms the dashboard reflects
 * the completion. Nothing is mocked.
 *
 * Requires PostgreSQL and migrations (`docker compose up -d postgres` and
 * `npm run db:migrate`), which the Playwright `webServer` block depends on for
 * the API health check.
 */
test.describe('court scheduling and dashboard', () => {
  test('schedule a match on a court and see it progress on the dashboard', async ({ page }) => {
    const unique = Date.now();
    const tournamentName = `E2E Courts ${unique}`;
    const categoryName = `E2E Court Group ${unique}`;
    const categoryCode = `C${String(unique).slice(-4)}`;
    const playerOne = `E2E Court Alice ${unique}`;
    const playerTwo = `E2E Court Bob ${unique}`;

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

    // Create a court for the tournament.
    await page.goto(`${tournamentUrl}/courts/manage`);
    await page.getByLabel(/^Number/).fill('1');
    await page.getByLabel(/^Name/).fill('Court One');
    await page.getByRole('button', { name: 'Add court' }).click();
    await expect(page.getByRole('cell', { name: 'Court One' })).toBeVisible({ timeout: 15_000 });

    // Create a singles category and open it.
    await page.goto(`${tournamentUrl}/categories/new`);
    await page.getByLabel(/^Name/).fill(categoryName);
    await page.getByLabel(/^Code/).fill(categoryCode);
    await page.getByRole('button', { name: 'Create category' }).click();
    await expect(page.getByRole('heading', { name: categoryName })).toBeVisible();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByText('Open', { exact: true }).first()).toBeVisible();
    const categoryUrl = page.url();

    // Create two players and register them.
    const playerIds: string[] = [];
    for (const name of [playerOne, playerTwo]) {
      await page.goto('/players');
      await page.getByLabel(/^Name/).fill(name);
      await page.getByRole('button', { name: 'Create player' }).click();
      const link = page.getByRole('link', { name });
      await expect(link).toBeVisible();
      const href = await link.getAttribute('href');
      playerIds.push(href?.split('/').pop() ?? '');
    }

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

    // Resolve entry ids from the API (the registration UI does not show them).
    const categoryId = categoryUrl.split('/').pop() ?? '';
    const entriesResponse = await page.request.get(
      `${API_BASE_URL}/api/v1/categories/${categoryId}/entries`,
    );
    const entriesBody = (await entriesResponse.json()) as {
      data: { id: string; playerId: string | null }[];
    };
    const entryIds = playerIds.map(
      (playerId) => entriesBody.data.find((entry) => entry.playerId === playerId)?.id ?? '',
    );
    expect(entryIds.every((id) => id.length > 0)).toBe(true);

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
    const matchUrl = page.url();

    // Assign both players to their slots.
    await page.getByLabel(/^Slot 1 entry ID/).fill(entryIds[0] as string);
    await page.getByRole('button', { name: 'Assign' }).first().click();
    await page.getByLabel(/^Slot 2 entry ID/).fill(entryIds[1] as string);
    await page.getByRole('button', { name: 'Assign' }).nth(1).click();
    await expect(page.getByText(playerOne).first()).toBeVisible({ timeout: 15_000 });

    // Schedule the match on the court for a fixed future window.
    await page.getByLabel('Court').click();
    await page.getByRole('option', { name: /Court 1/ }).click();
    await page.getByLabel(/^Start/).fill('2026-10-05T10:00');
    await page.getByLabel(/^End/).fill('2026-10-05T10:30');
    await page.getByRole('button', { name: 'Schedule match' }).click();
    await expect(page.getByText('Starts').first()).toBeVisible({ timeout: 15_000 });

    // The court board shows the scheduled match against Court 1.
    await page.goto(`${tournamentUrl}/courts`);
    await expect(page.getByText('Court 1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(playerOne).first()).toBeVisible();

    // The dashboard reports the scheduled match.
    await page.goto(`${tournamentUrl}/dashboard`);
    await expect(page.getByText('Scheduled').first()).toBeVisible({ timeout: 15_000 });

    // Play the match: start it and record a single-game group result.
    await page.goto(matchUrl);
    await page.getByRole('button', { name: 'In Progress' }).click();
    await expect(page.getByText('In progress').first()).toBeVisible();

    await page.getByLabel(`Game — ${playerOne} points`).fill('21');
    await page.getByLabel(`Game — ${playerTwo} points`).fill('18');
    await page.getByRole('button', { name: 'Save & complete result' }).click();
    await expect(page.getByTestId('match-result-winner')).toContainText(playerOne, {
      timeout: 15_000,
    });

    // A completed match can no longer be rescheduled.
    await expect(
      page.getByText('A match can only be scheduled or cleared while it is scheduled.'),
    ).toBeVisible();

    // The dashboard reflects the completion in its recent results.
    await page.goto(`${tournamentUrl}/dashboard`);
    await expect(page.getByText('Recent results')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(playerOne, { exact: false }).first()).toBeVisible();
  });

  test('schedule and play a knockout bracket through to the dashboard champion', async ({
    page,
    request,
  }) => {
    const unique = Date.now();
    const tournamentName = `E2E KO Schedule ${unique}`;
    const categoryName = `E2E KO Bracket ${unique}`;
    const categoryCode = `Q${String(unique).slice(-4)}`;
    const playerNames = [1, 2, 3, 4].map((n) => `E2E KO ${String(n)} ${unique}`);

    const post = async <T>(url: string, payload: unknown): Promise<T> => {
      const response = await request.post(`${API_BASE_URL}${url}`, { data: payload });
      expect(response.ok(), `${url} -> ${String(response.status())}`).toBe(true);
      return (await response.json()) as T;
    };

    const tournament = await post<{ data: Entity }>('/api/v1/tournaments', {
      name: tournamentName,
      startDate: '2026-10-01',
      endDate: '2026-10-05',
      timezone: 'UTC',
    });
    const tournamentId = tournament.data.id;
    await post(`/api/v1/tournaments/${tournamentId}/transition`, { status: 'REGISTRATION_OPEN' });

    const category = await post<{ data: Entity }>(
      `/api/v1/tournaments/${tournamentId}/categories`,
      {
        name: categoryName,
        code: categoryCode,
        format: 'SINGLES',
      },
    );
    await post(`/api/v1/categories/${category.data.id}/transition`, { status: 'OPEN' });

    const entryIds: string[] = [];
    const nameByEntry = new Map<string, string>();
    for (const name of playerNames) {
      const player = await post<{ data: Entity }>('/api/v1/players', { name });
      const entry = await post<{ data: Entity }>(`/api/v1/categories/${category.data.id}/entries`, {
        playerId: player.data.id,
      });
      entryIds.push(entry.data.id);
      nameByEntry.set(entry.data.id, name);
    }

    // A single court for the tournament.
    await post(`/api/v1/tournaments/${tournamentId}/courts`, { number: 1, name: 'Centre Court' });

    // Create and generate a 4-entry knockout bracket.
    const stage = await post<{ data: Entity }>(`/api/v1/categories/${category.data.id}/stages`, {
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
    });
    await post(`/api/v1/stages/${stage.data.id}/transition`, { status: 'ACTIVE' });
    await post(`/api/v1/stages/${stage.data.id}/bracket`, { entryIds });

    const categoryUrl = `/tournaments/${tournamentId}/categories/${category.data.id}`;
    const stageUrl = `${categoryUrl}/stages/${stage.data.id}`;

    let bracket = await readBracket(request, stage.data.id);
    const semifinals = bracket.rounds.find((round) => round.roundNumber === 1)?.matches ?? [];
    const semifinal = required(semifinals[0], 'the first semifinal');
    const semifinalUrl = `${categoryUrl}/matches/${semifinal.matchId}`;
    const semifinalSlot1 = nameByEntry.get(semifinal.participant1.entryId ?? '') ?? '';
    const semifinalSlot2 = nameByEntry.get(semifinal.participant2.entryId ?? '') ?? '';

    // Schedule the semifinal on the court.
    await page.goto(semifinalUrl);
    await page.getByLabel('Court').click();
    await page.getByRole('option', { name: /Court 1/ }).click();
    await page.getByLabel(/^Start/).fill('2026-10-05T10:00');
    await page.getByLabel(/^End/).fill('2026-10-05T10:30');
    await page.getByRole('button', { name: 'Schedule match' }).click();
    await expect(page.getByText('Starts').first()).toBeVisible({ timeout: 15_000 });

    // Play the semifinal; slot 1 advances.
    await page.getByRole('button', { name: 'In Progress' }).click();
    await expect(page.getByText('In progress').first()).toBeVisible();
    await page.getByLabel(`Game 1 — ${semifinalSlot1} points`).fill('21');
    await page.getByLabel(`Game 1 — ${semifinalSlot2} points`).fill('15');
    await page.getByLabel(`Game 2 — ${semifinalSlot1} points`).fill('21');
    await page.getByLabel(`Game 2 — ${semifinalSlot2} points`).fill('12');
    await page.getByRole('button', { name: 'Save & complete result' }).click();
    await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 15_000 });

    // The winner progressed into the final's slot 1.
    bracket = await readBracket(request, stage.data.id);
    let finalMatch = required(
      bracket.rounds.find((round) => round.roundNumber === 2)?.matches[0],
      'the final',
    );
    expect(finalMatch.participant1.entryId).toBe(entryIds[0]);

    // Play the second semifinal so the final has both finalists.
    const secondSemifinal = required(semifinals[1], 'the second semifinal');
    await page.goto(`${categoryUrl}/matches/${secondSemifinal.matchId}`);
    await page.getByRole('button', { name: 'In Progress' }).click();
    await expect(page.getByText('In progress').first()).toBeVisible();
    await page
      .getByLabel(
        `Game 1 — ${nameByEntry.get(secondSemifinal.participant1.entryId ?? '') ?? ''} points`,
      )
      .fill('21');
    await page
      .getByLabel(
        `Game 1 — ${nameByEntry.get(secondSemifinal.participant2.entryId ?? '') ?? ''} points`,
      )
      .fill('13');
    await page
      .getByLabel(
        `Game 2 — ${nameByEntry.get(secondSemifinal.participant1.entryId ?? '') ?? ''} points`,
      )
      .fill('21');
    await page
      .getByLabel(
        `Game 2 — ${nameByEntry.get(secondSemifinal.participant2.entryId ?? '') ?? ''} points`,
      )
      .fill('14');
    await page.getByRole('button', { name: 'Save & complete result' }).click();
    await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 15_000 });

    // The final now has both finalists, and it was NOT auto-scheduled.
    bracket = await readBracket(request, stage.data.id);
    finalMatch = required(
      bracket.rounds.find((round) => round.roundNumber === 2)?.matches[0],
      'the final',
    );
    expect(finalMatch.participant1.entryId).toBe(entryIds[0]);
    expect(finalMatch.participant2.entryId).toBe(entryIds[2]);
    const finalUrl = `${categoryUrl}/matches/${finalMatch.matchId}`;
    await page.goto(finalUrl);
    await expect(page.getByText('This match has no court or time yet.')).toBeVisible();

    // Schedule the final manually, then complete it.
    await page.getByLabel('Court').click();
    await page.getByRole('option', { name: /Court 1/ }).click();
    await page.getByLabel(/^Start/).fill('2026-10-05T11:00');
    await page.getByLabel(/^End/).fill('2026-10-05T11:30');
    await page.getByRole('button', { name: 'Schedule match' }).click();
    await expect(page.getByText('Starts').first()).toBeVisible({ timeout: 15_000 });

    const finalSlot1 = nameByEntry.get(finalMatch.participant1.entryId ?? '') ?? '';
    const finalSlot2 = nameByEntry.get(finalMatch.participant2.entryId ?? '') ?? '';
    await page.getByRole('button', { name: 'In Progress' }).click();
    await expect(page.getByText('In progress').first()).toBeVisible();
    await page.getByLabel(`Game 1 — ${finalSlot1} points`).fill('21');
    await page.getByLabel(`Game 1 — ${finalSlot2} points`).fill('10');
    await page.getByLabel(`Game 2 — ${finalSlot1} points`).fill('21');
    await page.getByLabel(`Game 2 — ${finalSlot2} points`).fill('11');
    await page.getByRole('button', { name: 'Save & complete result' }).click();
    await expect(page.getByTestId('match-result-winner')).toContainText(finalSlot1, {
      timeout: 15_000,
    });

    // The stage is complete and the dashboard reflects the champion.
    await page.goto(stageUrl);
    await expect(page.getByText(/champion decided/)).toBeVisible({ timeout: 15_000 });
    await page.goto(`/tournaments/${tournamentId}/dashboard`);
    await expect(page.getByText('Recent results')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(finalSlot1, { exact: false }).first()).toBeVisible();
  });
});

/** Narrows an optional value, failing fast in the test. */
function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined.`);
  }
  return value;
}

async function readBracket(request: APIRequestContext, stageId: string): Promise<Bracket> {
  const response = await request.get(`${API_BASE_URL}/api/v1/stages/${stageId}/bracket`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: Bracket }).data;
}
