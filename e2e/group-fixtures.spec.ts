import { expect, test } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

interface Entity {
  readonly id: string;
}

/**
 * Group-stage fixture generation, against the real UI, API and PostgreSQL.
 *
 * Registers competitors, creates a GROUP stage, generates the round-robin from
 * the fixture setup, verifies the fixtures are persisted and returned by the
 * API, shown in the UI, survive a page refresh and can be scheduled on a court.
 * Nothing is mocked: every step goes through the running Fastify API and the
 * database.
 *
 * Requires PostgreSQL and migrations (`docker compose up -d postgres` and
 * `npm run db:migrate`), which the Playwright `webServer` block depends on for
 * the API health check.
 */
test.describe('group fixtures', () => {
  test('generate, persist, retrieve and refresh a singles round-robin', async ({
    page,
    request,
  }) => {
    const unique = Date.now();
    const tournamentName = `E2E Fixtures ${unique}`;
    const categoryName = `E2E Fixture Group ${unique}`;
    const categoryCode = `F${String(unique).slice(-4)}`;
    const playerNames = [1, 2, 3, 4].map((n) => `E2E Fixture Player ${String(n)} ${unique}`);

    const post = async <T>(url: string, payload: unknown): Promise<T> => {
      const response = await request.post(`${API_BASE_URL}${url}`, { data: payload });
      expect(response.ok(), `${url} -> ${String(response.status())}`).toBe(true);
      return (await response.json()) as T;
    };

    // --- Setup over the API so the test focuses on the fixture UI. ----------
    const tournament = await post<{ data: Entity }>('/api/v1/tournaments', {
      name: tournamentName,
      startDate: '2026-10-01',
      endDate: '2026-10-05',
      timezone: 'Asia/Kolkata',
    });
    await post(`/api/v1/tournaments/${tournament.data.id}/transition`, {
      status: 'REGISTRATION_OPEN',
    });
    await post(`/api/v1/tournaments/${tournament.data.id}/courts`, {
      number: 1,
      name: 'Court 1',
    });

    const category = await post<{ data: Entity }>(
      `/api/v1/tournaments/${tournament.data.id}/categories`,
      { name: categoryName, code: categoryCode, format: 'SINGLES' },
    );
    await post(`/api/v1/categories/${category.data.id}/transition`, { status: 'OPEN' });

    for (const name of playerNames) {
      const player = await post<{ data: Entity }>('/api/v1/players', { name });
      await post(`/api/v1/categories/${category.data.id}/entries`, { playerId: player.data.id });
    }

    // --- Stage creation and fixture generation in the UI. -------------------
    const categoryUrl = `/tournaments/${tournament.data.id}/categories/${category.data.id}`;

    await page.goto(`${categoryUrl}/stages`);
    await page.getByLabel(/^Name/).fill('Group A');
    await page.getByRole('button', { name: 'Create stage' }).click();

    const stageLink = page.locator('a[href*="/stages/"]');
    await expect(stageLink).toBeVisible();
    await stageLink.click();
    const stageUrl = page.url();
    const stageId = stageUrl.split('/').pop() ?? '';

    // The fixtures start ungenerated: the setup offers the active entries.
    await expect(page.getByText('No matches yet')).toBeVisible();
    for (const name of playerNames) {
      await page.getByRole('checkbox', { name: new RegExp(name) }).check();
    }
    await expect(page.getByTestId('group-fixture-shape')).toContainText('6 matches');

    await page.getByRole('button', { name: 'Generate fixtures' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Generate fixtures' }).click();

    // Four competitors produce six matches, shown in the match list.
    const matchLinks = page.locator('a[href*="/matches/"]');
    await expect(matchLinks).toHaveCount(6, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Generate fixtures', exact: true })).toHaveCount(
      0,
    );

    // The fixtures are persisted and returned by the API.
    const fixturesResponse = await page.request.get(
      `${API_BASE_URL}/api/v1/stages/${stageId}/matches`,
    );
    expect(fixturesResponse.ok()).toBe(true);
    const fixturesBody = (await fixturesResponse.json()) as { data: readonly Entity[] };
    expect(fixturesBody.data).toHaveLength(6);

    // Each match has both slots filled with a real entry, and every pairing is
    // distinct: no duplicate fixtures.
    const pairings = new Set<string>();
    for (const match of fixturesBody.data) {
      const participants = await page.request.get(
        `${API_BASE_URL}/api/v1/matches/${match.id}/participants`,
      );
      const body = (await participants.json()) as {
        data: readonly { entryId: string; slot: number }[];
      };
      expect(body.data).toHaveLength(2);
      const ids = body.data.map((participant) => participant.entryId);
      expect(ids[0]).not.toBe(ids[1]);
      pairings.add([...ids].sort().join('|'));
    }
    expect(pairings.size).toBe(6);

    // A page refresh reloads the same fixtures from the API.
    await page.reload();
    await expect(page.locator('a[href*="/matches/"]')).toHaveCount(6, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Generate fixtures', exact: true })).toHaveCount(
      0,
    );

    // Regeneration is rejected: the fixtures are not duplicated.
    const entriesResponse = await page.request.get(
      `${API_BASE_URL}/api/v1/categories/${category.data.id}/entries`,
    );
    const entriesBody = (await entriesResponse.json()) as { data: readonly Entity[] };
    const entryIds = entriesBody.data.map((entry) => entry.id);
    const secondAttempt = await request.post(`${API_BASE_URL}/api/v1/stages/${stageId}/fixtures`, {
      data: { entryIds },
    });
    expect(secondAttempt.status()).toBe(409);
    const stillSix = await page.request.get(`${API_BASE_URL}/api/v1/stages/${stageId}/matches`);
    expect(((await stillSix.json()) as { data: readonly Entity[] }).data).toHaveLength(6);

    // --- Court assignment and scheduling integration. -----------------------
    const firstMatch = fixturesBody.data[0];
    if (!firstMatch) {
      throw new Error('Expected at least one fixture.');
    }
    const courtsResponse = await page.request.get(
      `${API_BASE_URL}/api/v1/tournaments/${tournament.data.id}/courts`,
    );
    const courtsBody = (await courtsResponse.json()) as { data: readonly Entity[] };
    const courtId = courtsBody.data[0]?.id ?? '';
    expect(courtId.length).toBeGreaterThan(0);

    const schedule = await request.post(
      `${API_BASE_URL}/api/v1/matches/${firstMatch.id}/schedule`,
      {
        data: {
          courtId,
          scheduledStartAt: '2026-10-05T10:00:00.000Z',
          scheduledEndAt: '2026-10-05T10:30:00.000Z',
        },
      },
    );
    expect(schedule.ok(), `schedule -> ${String(schedule.status())}`).toBe(true);

    // The court board shows the scheduled fixture on Court 1.
    await page.goto(`/tournaments/${tournament.data.id}/courts`);
    await expect(page.getByText('Court 1').first()).toBeVisible({ timeout: 15_000 });
  });

  test('generate a doubles round-robin from team entries', async ({ page, request }) => {
    const unique = Date.now();
    const tournamentName = `E2E Doubles Fixtures ${unique}`;
    const categoryName = `E2E Doubles Group ${unique}`;
    const categoryCode = `D${String(unique).slice(-4)}`;

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
      { name: categoryName, code: categoryCode, format: 'DOUBLES' },
    );
    await post(`/api/v1/categories/${category.data.id}/transition`, { status: 'OPEN' });

    // Three teams, each with two players, registered as team entries.
    const teamNames = [1, 2, 3].map((n) => `E2E Team ${String(n)} ${unique}`);
    for (const teamName of teamNames) {
      const members: string[] = [];
      for (let member = 0; member < 2; member += 1) {
        const player = await post<{ data: Entity }>('/api/v1/players', {
          name: `${teamName} P${String(member + 1)}`,
        });
        members.push(player.data.id);
      }
      const team = await post<{ data: Entity }>('/api/v1/teams', {
        name: teamName,
        memberPlayerIds: members,
      });
      await post(`/api/v1/categories/${category.data.id}/entries`, { teamId: team.data.id });
    }

    const categoryUrl = `/tournaments/${tournament.data.id}/categories/${category.data.id}`;
    await page.goto(`${categoryUrl}/stages`);
    await page.getByLabel(/^Name/).fill('Doubles Group A');
    await page.getByRole('button', { name: 'Create stage' }).click();

    const stageLink = page.locator('a[href*="/stages/"]');
    await expect(stageLink).toBeVisible();
    await stageLink.click();
    const stageId = page.url().split('/').pop() ?? '';

    for (const teamName of teamNames) {
      await page.getByRole('checkbox', { name: new RegExp(teamName) }).check();
    }
    await expect(page.getByTestId('group-fixture-shape')).toContainText('3 matches');

    await page.getByRole('button', { name: 'Generate fixtures' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Generate fixtures' }).click();

    await expect(page.locator('a[href*="/matches/"]')).toHaveCount(3, { timeout: 15_000 });

    const response = await page.request.get(`${API_BASE_URL}/api/v1/stages/${stageId}/matches`);
    const body = (await response.json()) as { data: readonly Entity[] };
    expect(body.data).toHaveLength(3);

    // The persisted participants are the three team entries, not players.
    const participantEntryIds = new Set<string>();
    for (const match of body.data) {
      const participants = await page.request.get(
        `${API_BASE_URL}/api/v1/matches/${match.id}/participants`,
      );
      const payload = (await participants.json()) as {
        data: readonly { entryId: string }[];
      };
      for (const participant of payload.data) {
        participantEntryIds.add(participant.entryId);
      }
    }
    expect(participantEntryIds.size).toBe(3);
  });
});
