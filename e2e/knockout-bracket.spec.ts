import { expect, test, type APIRequestContext } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * Phase 6 knockout bracket flow, against the real UI, API and PostgreSQL.
 *
 * Sets up a tournament, category and four entries, creates a KNOCKOUT stage in
 * the UI, generates a 4-entry bracket, then plays both semifinals and the final
 * through the existing match-detail scoring UI, verifying that each winner
 * advances and the champion is decided. Nothing is mocked: every step goes
 * through the running Fastify API and the database.
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
  readonly status: string;
  readonly rounds: readonly {
    readonly roundNumber: number;
    readonly matches: readonly BracketMatch[];
  }[];
}

test.describe('knockout bracket', () => {
  test('runs a four-entry bracket from semifinals to champion', async ({ page, request }) => {
    const unique = Date.now();
    const tournamentName = `E2E Knockout ${unique}`;
    const categoryName = `E2E Bracket ${unique}`;
    const categoryCode = `K${String(unique).slice(-4)}`;
    const playerNames = [1, 2, 3, 4].map((n) => `E2E Bracket Player ${String(n)} ${unique}`);

    // --- Setup over the API so the test focuses on the bracket UI. ----------
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

    // --- Stage creation and bracket generation in the UI. -------------------
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

    // The bracket starts ungenerated: setup offers the active entries.
    await expect(page.getByText('No bracket yet')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Standings' })).toHaveCount(0);

    for (const name of playerNames) {
      await page.getByRole('checkbox', { name: new RegExp(name) }).check();
    }
    await expect(page.getByTestId('bracket-shape')).toContainText('Semifinals (2), Final (1)');

    await page.getByRole('button', { name: 'Generate bracket' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Generate bracket' }).click();

    // The bracket renders two semifinals and a final with TBD finalists.
    await expect(page.getByText(/4-entry bracket/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Semifinals' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Final', exact: true })).toBeVisible();
    await expect(page.getByText('TBD').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate bracket' })).toHaveCount(0);

    // Bracket generation is real: read it back from the API.
    let bracket = await readBracket(request, stageId);
    expect(bracket.bracketSize).toBe(4);
    const semifinals = bracket.rounds.find((round) => round.roundNumber === 1)?.matches ?? [];
    const finalBefore = bracket.rounds.find((round) => round.roundNumber === 2)?.matches[0];
    expect(semifinals).toHaveLength(2);
    expect(finalBefore?.participant1.entryId).toBeNull();
    expect(finalBefore?.participant2.entryId).toBeNull();
    // Entries are paired in the supplied order.
    expect(semifinals[0]?.participant1.entryId).toBe(entryIds[0]);
    expect(semifinals[0]?.participant2.entryId).toBe(entryIds[1]);

    // Activate the stage so its matches can start (existing PENDING → ACTIVE).
    await page.goto(stageUrl);
    await page.getByRole('button', { name: 'Active', exact: true }).click();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
    bracket = await readBracket(request, stageId);
    expect(bracket.status).toBe('ACTIVE');

    // --- Play both semifinals and the final via the match UI. --------------
    // Slot 1 always wins, which keeps the expectation simple.
    const playMatch = async (match: BracketMatch): Promise<void> => {
      const winnerEntryId = match.participant1.entryId ?? '';
      const loserEntryId = match.participant2.entryId ?? '';
      const slot1Name = nameByEntry.get(winnerEntryId) ?? '';
      const slot2Name = nameByEntry.get(loserEntryId) ?? '';

      await page.goto(`${categoryUrl}/matches/${match.matchId}`);
      await page.getByRole('button', { name: 'In Progress' }).click();
      await expect(page.getByText('In progress').first()).toBeVisible();

      await page.getByLabel(`Game 1 — ${slot1Name} points`).fill('21');
      await page.getByLabel(`Game 1 — ${slot2Name} points`).fill('15');
      await page.getByLabel(`Game 2 — ${slot1Name} points`).fill('21');
      await page.getByLabel(`Game 2 — ${slot2Name} points`).fill('12');
      await page.getByRole('button', { name: 'Save & complete result' }).click();
      await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 15_000 });
    };

    // Semi 1: the first-listed entry (slot 1) wins.
    await playMatch(required(semifinals[0], 'the first semifinal'));
    bracket = await readBracket(request, stageId);
    const finalAfterSemi1 = bracket.rounds.find((round) => round.roundNumber === 2)?.matches[0];
    expect(finalAfterSemi1?.participant1.entryId).toBe(entryIds[0]);
    expect(finalAfterSemi1?.participant2.entryId).toBeNull();
    // The stage stays active until the final is decided.
    expect(bracket.status).toBe('ACTIVE');
    expect(bracket.complete).toBe(false);

    // Semi 2: its slot-1 entry (the third entry) wins.
    await playMatch(required(semifinals[1], 'the second semifinal'));
    bracket = await readBracket(request, stageId);
    const decider = bracket.rounds.find((round) => round.roundNumber === 2)?.matches[0];
    expect(decider?.participant1.entryId).toBe(entryIds[0]);
    expect(decider?.participant2.entryId).toBe(entryIds[2]);

    // Final: the first entry is the champion, and the stage completes.
    await playMatch(required(decider, 'the final'));
    bracket = await readBracket(request, stageId);
    expect(bracket.complete).toBe(true);
    expect(bracket.status).toBe('COMPLETED');

    // The stage page shows the completed bracket and no setup.
    await page.goto(stageUrl);
    await expect(page.getByText(/champion decided/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Generate bracket' })).toHaveCount(0);
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
