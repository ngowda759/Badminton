import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

interface Entity {
  readonly id: string;
}

interface Fixture {
  readonly tournamentId: string;
  readonly categoryId: string;
  readonly stageId: string;
  readonly matchId: string;
  readonly courtId: string;
  readonly playerName: string;
}

/** The card whose `CardTitle` heading is `title`. */
function cardWithTitle(page: Page, title: string) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: title }) });
}

/** POSTs `payload` and asserts success, returning the parsed body. */
async function post<T>(request: APIRequestContext, url: string, payload: unknown): Promise<T> {
  const response = await request.post(`${API_BASE_URL}${url}`, { data: payload });
  expect(response.ok(), `${url} -> ${String(response.status())}`).toBe(true);
  return (await response.json()) as T;
}

/**
 * Creates one tournament with a single unscheduled, participant-assigned group
 * match and one court. Everything is driven through the real REST API, so the
 * browsers under test only ever read authoritative state.
 */
async function createTournamentFixture(
  request: APIRequestContext,
  options: { readonly suffix: string; readonly schedule?: boolean },
): Promise<Fixture> {
  const unique = `${String(Date.now())}-${options.suffix}`;
  // A short code derived from the numeric part only (the suffix is alphabetic).
  const code = `H${unique.replace(/\D/g, '').slice(-4)}`;
  const playerName = `E2E 8.6 ${unique}`;

  const tournament = await post<{ data: Entity }>(request, '/api/v1/tournaments', {
    name: `E2E 8.6 ${unique}`,
    startDate: '2026-10-01',
    endDate: '2026-10-05',
    timezone: 'UTC',
  });
  const tournamentId = tournament.data.id;
  await post(request, `/api/v1/tournaments/${tournamentId}/transition`, {
    status: 'REGISTRATION_OPEN',
  });

  const category = await post<{ data: Entity }>(
    request,
    `/api/v1/tournaments/${tournamentId}/categories`,
    { name: `Group ${unique}`, code, format: 'SINGLES' },
  );
  await post(request, `/api/v1/categories/${category.data.id}/transition`, { status: 'OPEN' });

  const entryIds: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const player = await post<{ data: Entity }>(request, '/api/v1/players', {
      name: `${playerName} ${String(index)}`,
    });
    const entry = await post<{ data: Entity }>(
      request,
      `/api/v1/categories/${category.data.id}/entries`,
      { playerId: player.data.id },
    );
    entryIds.push(entry.data.id);
  }

  const court = await post<{ data: Entity }>(
    request,
    `/api/v1/tournaments/${tournamentId}/courts`,
    { number: 1, name: 'Court One' },
  );

  const stage = await post<{ data: Entity }>(
    request,
    `/api/v1/categories/${category.data.id}/stages`,
    { name: 'Group A', type: 'GROUP', sequence: 1 },
  );
  await post(request, `/api/v1/stages/${stage.data.id}/transition`, { status: 'ACTIVE' });
  const match = await post<{ data: Entity }>(request, `/api/v1/stages/${stage.data.id}/matches`, {
    sequence: 1,
  });
  const matchId = match.data.id;
  await post(request, `/api/v1/matches/${matchId}/participants`, {
    entryId: entryIds[0],
    slot: 1,
  });
  await post(request, `/api/v1/matches/${matchId}/participants`, {
    entryId: entryIds[1],
    slot: 2,
  });

  if (options.schedule) {
    await post(request, `/api/v1/matches/${matchId}/schedule`, {
      courtId: court.data.id,
      scheduledStartAt: '2026-10-05T10:00:00.000Z',
      scheduledEndAt: '2026-10-05T10:30:00.000Z',
    });
  }

  return {
    tournamentId,
    categoryId: category.data.id,
    stageId: stage.data.id,
    matchId,
    courtId: court.data.id,
    playerName,
  };
}

async function waitForConnected(page: Page): Promise<void> {
  await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-status', 'CONNECTED', {
    timeout: 15_000,
  });
}

/**
 * Counts the dashboard REST reads a page issues, so a test can prove a refresh
 * did or did not happen (a realtime refresh shows up as an extra GET).
 */
function countDashboardReads(page: Page): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && /\/dashboard(\?|$)/.test(new URL(request.url()).pathname)) {
      count += 1;
    }
  });
  return () => count;
}

test.describe('Phase 8.6 multi-device hardening', () => {
  /**
   * Test 2 - tournament isolation (mandatory).
   *
   * Browser A follows Tournament A, Browser B follows Tournament B. A mutation
   * in A must reach A's clients only: B must issue no realtime-triggered
   * dashboard read, proving the SSE subscription and the refresh bus are
   * tournament-scoped.
   */
  test('a Tournament A change refreshes only Tournament A clients', async ({
    page,
    context,
    request,
  }) => {
    test.slow();
    const fixtureA = await createTournamentFixture(request, { suffix: 'iso-a' });
    const fixtureB = await createTournamentFixture(request, { suffix: 'iso-b' });

    const pageB = await context.newPage();
    const readsA = countDashboardReads(page);
    const readsB = countDashboardReads(pageB);

    await page.goto(`/tournaments/${fixtureA.tournamentId}/dashboard`);
    await waitForConnected(page);
    await expect(
      cardWithTitle(page, 'Needs scheduling').getByText(fixtureA.playerName, { exact: false }),
    ).toBeVisible();

    await pageB.goto(`/tournaments/${fixtureB.tournamentId}/dashboard`);
    await waitForConnected(pageB);
    await expect(
      cardWithTitle(pageB, 'Needs scheduling').getByText(fixtureB.playerName, { exact: false }),
    ).toBeVisible();

    const readsABefore = readsA();
    const readsBBefore = readsB();

    // Mutate Tournament A only.
    await post(request, `/api/v1/matches/${fixtureA.matchId}/schedule`, {
      courtId: fixtureA.courtId,
      scheduledStartAt: '2026-10-05T10:00:00.000Z',
      scheduledEndAt: '2026-10-05T10:30:00.000Z',
    });

    // Tournament A refreshes: its match moves to "Upcoming".
    await expect(
      cardWithTitle(page, 'Upcoming').getByText(fixtureA.playerName, { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
    await expect.poll(readsA).toBeGreaterThan(readsABefore);

    // Tournament B is untouched: it must not have issued an extra read.
    await pageB.waitForTimeout(1_000);
    expect(readsB()).toBe(readsBBefore);
    await expect(
      cardWithTitle(pageB, 'Needs scheduling').getByText(fixtureB.playerName, { exact: false }),
    ).toBeVisible();

    await pageB.close();
  });

  /**
   * Test 3 - disconnect / reconnect recovery (mandatory).
   *
   * The first SSE attempt is ended by a finite response (as a dropped
   * connection), driving the browser into its native reconnect. Mutations then
   * happen while the stream is down, so their SSE events are missed: Phase 8.2
   * does not replay. When the browser's retry reconnects to the real stream, the
   * provider must refetch authoritative REST state and surface the change.
   */
  test('a reconnect after missed events recovers the authoritative state', async ({
    page,
    request,
  }) => {
    test.slow();
    const fixture = await createTournamentFixture(request, { suffix: 'reconnect' });

    // While `allowLive` is false every subscription is ended immediately (a
    // finite SSE body), keeping the browser in its reconnect loop. Once the
    // missed events have been produced, the next retry is allowed through to the
    // real stream, so the reconnect (and its authoritative refetch) is the first
    // time the browser sees the new state.
    let allowLive = false;
    let attempts = 0;
    await page.route('**/api/v1/tournaments/*/events', async (route) => {
      attempts += 1;
      if (!allowLive) {
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
          body: ': connected\n\n',
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`/tournaments/${fixture.tournamentId}/dashboard`);
    // The dropped stream puts the client into its reconnect state.
    await expect(page.getByTestId('realtime-status')).toHaveAttribute(
      'data-status',
      'RECONNECTING',
      { timeout: 15_000 },
    );
    await expect(
      cardWithTitle(page, 'Needs scheduling').getByText(fixture.playerName, { exact: false }),
    ).toBeVisible();

    // Mutations happen while the browser cannot see them (still reconnecting).
    await post(request, `/api/v1/matches/${fixture.matchId}/schedule`, {
      courtId: fixture.courtId,
      scheduledStartAt: '2026-10-05T10:00:00.000Z',
      scheduledEndAt: '2026-10-05T10:30:00.000Z',
    });
    await post(request, `/api/v1/courts/${fixture.courtId}/transition`, { status: 'INACTIVE' });

    // Connectivity is restored: the browser retries, reconnects to the real
    // stream, and the reconnect triggers an authoritative refetch (no replay).
    allowLive = true;
    await waitForConnected(page);
    expect(attempts).toBeGreaterThanOrEqual(2);

    await expect(
      cardWithTitle(page, 'Upcoming').getByText(fixture.playerName, { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      cardWithTitle(page, 'Needs scheduling').getByText('Every match has a court and time.'),
    ).toBeVisible();
  });

  /**
   * Concurrent events / request-storm protection.
   *
   * Several mutations fire close together (different event types). The UI must
   * converge on the authoritative REST state without issuing one request per
   * event; the coalescing window bounds the number of dashboard reads.
   */
  test('a burst of mutations converges with a bounded number of REST reads', async ({
    page,
    request,
  }) => {
    test.slow();
    const fixture = await createTournamentFixture(request, { suffix: 'burst' });
    const reads = countDashboardReads(page);

    await page.goto(`/tournaments/${fixture.tournamentId}/dashboard`);
    await waitForConnected(page);
    await expect(
      cardWithTitle(page, 'Needs scheduling').getByText(fixture.playerName, { exact: false }),
    ).toBeVisible();

    const readsBefore = reads();

    // A close-together burst spanning match, court and hierarchy events.
    await Promise.all([
      post(request, `/api/v1/matches/${fixture.matchId}/schedule`, {
        courtId: fixture.courtId,
        scheduledStartAt: '2026-10-05T10:00:00.000Z',
        scheduledEndAt: '2026-10-05T10:30:00.000Z',
      }),
      post(request, `/api/v1/courts/${fixture.courtId}/transition`, { status: 'INACTIVE' }),
      post(request, `/api/v1/tournaments/${fixture.tournamentId}/courts`, {
        number: 2,
        name: 'Court Two',
      }),
      post(request, `/api/v1/stages/${fixture.stageId}/transition`, { status: 'COMPLETED' }),
    ]);

    // The dashboard eventually reflects the new authoritative state.
    await expect(
      cardWithTitle(page, 'Upcoming').getByText(fixture.playerName, { exact: false }),
    ).toBeVisible({ timeout: 15_000 });

    // Settle, then assert the burst did not cause one request per event.
    await page.waitForTimeout(1_500);
    const totalReads = reads() - readsBefore;
    expect(totalReads).toBeGreaterThan(0);
    expect(totalReads).toBeLessThanOrEqual(4);
  });

  /**
   * Realtime failure must not break REST.
   *
   * With the SSE endpoint blocked at the browser, the dashboard still loads over
   * REST, a mutation through the API still succeeds, and manual refresh still
   * brings the change in.
   */
  test('the dashboard stays fully usable when the realtime stream is blocked', async ({
    page,
    request,
  }) => {
    test.slow();
    const fixture = await createTournamentFixture(request, { suffix: 'no-sse' });

    // Block the SSE endpoint only; ordinary REST is untouched.
    await page.route('**/api/v1/tournaments/*/events', (route) => route.abort());

    await page.goto(`/tournaments/${fixture.tournamentId}/dashboard`);
    await expect(
      cardWithTitle(page, 'Needs scheduling').getByText(fixture.playerName, { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
    // The stream is down; the indicator reports offline rather than crashing.
    await expect(page.getByTestId('realtime-status')).toHaveAttribute(
      'data-status',
      /RECONNECTING|DISCONNECTED/,
    );

    // Mutations still work server-side.
    await post(request, `/api/v1/matches/${fixture.matchId}/schedule`, {
      courtId: fixture.courtId,
      scheduledStartAt: '2026-10-05T10:00:00.000Z',
      scheduledEndAt: '2026-10-05T10:30:00.000Z',
    });

    // Manual refresh still brings the authoritative state in.
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(
      cardWithTitle(page, 'Upcoming').getByText(fixture.playerName, { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
