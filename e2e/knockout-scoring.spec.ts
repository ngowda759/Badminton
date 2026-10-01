import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * TASK-7 knockout scoring parity, against the real UI, API and PostgreSQL.
 *
 * Verifies the V1 knockout rules end to end: each round is played to its own
 * configured target (the defaults are QF 11, SF 15, Final 21), a knockout game
 * has no 30-point ceiling, the round's format can be changed to a straight set
 * before the bracket is generated, and the configuration is locked once the
 * knockout has started. Nothing is mocked.
 *
 * Requires PostgreSQL and migrations (`docker compose up -d postgres` and
 * `npm run db:migrate`), which the Playwright `webServer` block depends on for
 * the API health check.
 */

interface Entity {
  readonly id: string;
}

interface BracketMatch {
  readonly matchId: string;
  readonly participant1: { readonly entryId: string | null };
  readonly participant2: { readonly entryId: string | null };
  readonly winnerEntryId: string | null;
}

interface Bracket {
  readonly bracketSize: number;
  readonly complete: boolean;
  readonly rounds: readonly {
    readonly roundNumber: number;
    readonly matches: readonly BracketMatch[];
  }[];
}

test.describe('knockout scoring parity', () => {
  test('plays each round to its target, allows a straight-set final past 30 and locks the config', async ({
    page,
    request,
  }) => {
    const unique = Date.now();
    const tournamentName = `E2E Knockout Scoring ${unique}`;
    const categoryName = `E2E KO Scoring ${unique}`;
    const categoryCode = `S${String(unique).slice(-4)}`;
    const playerNames = [1, 2, 3, 4].map((n) => `E2E KO Player ${String(n)} ${unique}`);

    const post = async <T>(url: string, payload: unknown): Promise<T> => {
      const response = await request.post(`${API_BASE_URL}${url}`, { data: payload });
      expect(response.ok(), `${url} -> ${String(response.status())}`).toBe(true);
      return (await response.json()) as T;
    };

    const tournament = await post<{ data: Entity }>('/api/v1/tournaments', {
      name: tournamentName,
      startDate: '2026-10-01',
      endDate: '2026-10-05',
      timezone: 'Asia/Kolkata',
    });
    await post(`/api/v1/tournaments/${tournament.data.id}/transition`, {
      status: 'REGISTRATION_OPEN',
    });

    const category = await post<{ data: Entity }>(
      `/api/v1/tournaments/${tournament.data.id}/categories`,
      { name: categoryName, code: categoryCode, format: 'SINGLES' },
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

    // --- Create the knockout stage in the UI. -------------------------------
    const categoryUrl = `/tournaments/${tournament.data.id}/categories/${category.data.id}`;
    await page.goto(`${categoryUrl}/stages`);
    await page.getByLabel(/^Name/).fill('Knockout');
    await page.getByLabel('Type').click();
    await page.getByRole('option', { name: 'Knockout' }).click();
    await page.getByRole('button', { name: 'Create stage' }).click();

    const stageLink = page.locator('a[href*="/stages/"]');
    await expect(stageLink).toBeVisible();
    await stageLink.click();
    const stageUrl = page.url();
    const stageId = stageUrl.split('/').pop() ?? '';

    // --- The defaults match V1 before any bracket exists. -------------------
    // The editor is present (not locked) and shows the per-round defaults.
    await expect(page.getByText('Knockout scoring')).toBeVisible();
    await expect(page.getByLabel('Quarter-Final points per game', { exact: true })).toHaveValue(
      '11',
    );
    await expect(page.getByLabel('Semi-Final points per game', { exact: true })).toHaveValue('15');
    await expect(page.getByLabel('Final points per game', { exact: true })).toHaveValue('21');

    // Change the final to a straight set (one game) and save the configuration.
    await page.getByLabel('Final format', { exact: true }).click();
    await page.getByRole('option', { name: 'Straight set' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();

    // The saved catalogue is readable through the API.
    const savedStage = await request.get(`${API_BASE_URL}/api/v1/stages/${stageId}`);
    const savedRules = (await savedStage.json()) as {
      data: { knockoutRules: Record<string, { format: string; pointsPerGame: number }> };
    };
    expect(savedRules.data.knockoutRules.final).toEqual({
      format: 'single_game',
      pointsPerGame: 21,
    });
    expect(savedRules.data.knockoutRules.sf).toEqual({ format: 'best_of_3', pointsPerGame: 15 });

    // --- Generate the bracket from the four entries and activate it. --------
    for (const name of playerNames) {
      await page.getByRole('checkbox', { name: new RegExp(name) }).check();
    }
    await page.getByRole('button', { name: 'Generate bracket' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Generate bracket' }).click();
    await expect(page.getByText(/4-entry bracket/)).toBeVisible({ timeout: 15_000 });

    await page.goto(stageUrl);
    await page.getByRole('button', { name: 'Active', exact: true }).click();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();

    // The rules are locked once the knockout has started.
    await page.goto(stageUrl);
    await expect(page.getByText('Locked because the knockout stage has started.')).toBeVisible();
    await expect(page.getByLabel('Final points per game', { exact: true })).toBeDisabled();

    const bracket = await readBracket(request, stageId);
    const semifinals = bracket.rounds.find((round) => round.roundNumber === 1)?.matches ?? [];
    const finalMatch = bracket.rounds.find((round) => round.roundNumber === 2)?.matches[0];

    // --- A semifinal is best of three to the round's target of 15. ----------
    await playSemifinal(page, categoryUrl, nameByEntry, required(semifinals[0], 'semi 1'));
    await playSemifinal(page, categoryUrl, nameByEntry, required(semifinals[1], 'semi 2'));

    const decided = await readBracket(request, stageId);
    const decider = decided.rounds.find((round) => round.roundNumber === 2)?.matches[0];
    expect(decider?.participant1.entryId).toBe(entryIds[0]);
    expect(decider?.participant2.entryId).toBe(entryIds[2]);
    expect(finalMatch?.participant1.entryId).toBeNull();

    // --- The final is a straight set to 21, and 31-29 is legal (no ceiling). -
    const slot1Name = nameByEntry.get(decider?.participant1.entryId ?? '') ?? '';
    const slot2Name = nameByEntry.get(decider?.participant2.entryId ?? '') ?? '';
    await page.goto(`${categoryUrl}/matches/${required(decider, 'the final').matchId}`);
    await page.getByRole('button', { name: 'In Progress' }).click();
    await expect(page.getByText('In progress').first()).toBeVisible();

    // A straight-set match shows a single game, and the hint states the target.
    await expect(page.getByTestId('knockout-rule-hint')).toContainText('Straight set to 21 points');
    await expect(page.getByLabel(`Game 2 — ${slot1Name} points`)).toHaveCount(0);

    // 31-29 is won by two clear points and is accepted (a group game would cap at 30).
    await page.getByLabel(`Game — ${slot1Name} points`).fill('31');
    await page.getByLabel(`Game — ${slot2Name} points`).fill('29');
    await expect(page.getByTestId('match-winner')).toContainText(`Match winner: ${slot1Name}`);
    await page.getByRole('button', { name: 'Save & complete result' }).click();
    await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 15_000 });

    const finished = await readBracket(request, stageId);
    expect(finished.complete).toBe(true);

    await page.goto(stageUrl);
    await expect(page.getByText(/champion decided/)).toBeVisible({ timeout: 15_000 });
  });
});

/** Plays a best-of-three semifinal at the round's target of 15 (2-0). */
async function playSemifinal(
  page: Page,
  categoryUrl: string,
  nameByEntry: Map<string, string>,
  match: BracketMatch,
): Promise<void> {
  const slot1Name = nameByEntry.get(match.participant1.entryId ?? '') ?? '';
  const slot2Name = nameByEntry.get(match.participant2.entryId ?? '') ?? '';

  await page.goto(`${categoryUrl}/matches/${match.matchId}`);
  await page.getByRole('button', { name: 'In Progress' }).click();
  await expect(page.getByText('In progress').first()).toBeVisible();

  await expect(page.getByTestId('knockout-rule-hint')).toContainText('Best of 3 to 15 points');

  // 11 is below the semi-final target of 15, so the form flags it.
  await page.getByLabel(`Game 1 — ${slot1Name} points`).fill('11');
  await page.getByLabel(`Game 1 — ${slot2Name} points`).fill('5');
  await expect(page.getByTestId('match-score-error')).toContainText('reach 15 points');

  await page.getByLabel(`Game 1 — ${slot1Name} points`).fill('15');
  await page.getByLabel(`Game 1 — ${slot2Name} points`).fill('5');
  await page.getByLabel(`Game 2 — ${slot1Name} points`).fill('15');
  await page.getByLabel(`Game 2 — ${slot2Name} points`).fill('9');
  await expect(page.getByTestId('match-winner')).toContainText(`Match winner: ${slot1Name}`);
  await page.getByRole('button', { name: 'Save & complete result' }).click();
  await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 15_000 });
}

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
