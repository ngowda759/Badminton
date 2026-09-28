import { expect, test, type Page } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

interface Entity {
  readonly id: string;
}

/** The card whose `CardTitle` heading is `title`. */
function cardWithTitle(page: Page, title: string) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: title }) });
}

/**
 * Phase 8.5 live UI synchronization, against two real browsers, the real API
 * and PostgreSQL. Nothing is mocked.
 *
 * Browser A opens the tournament dashboard and subscribes to the SSE stream.
 * Browser B then schedules the match through the UI. Browser A must reflect the
 * change over its existing REST dashboard query without any manual refresh,
 * because the SSE event only told it that something changed.
 *
 * Requires PostgreSQL and migrations, as the Playwright `webServer` block does.
 */
test.describe('live dashboard synchronization', () => {
  test('a change made in another browser reaches the dashboard without a manual refresh', async ({
    page,
    context,
    request,
  }) => {
    const unique = Date.now();
    const tournamentName = `E2E Live ${unique}`;
    const categoryName = `E2E Live Group ${unique}`;
    const categoryCode = `L${String(unique).slice(-4)}`;
    const playerOne = `E2E Live Alice ${unique}`;
    const playerTwo = `E2E Live Bob ${unique}`;

    const post = async <T>(url: string, payload: unknown): Promise<T> => {
      const response = await request.post(`${API_BASE_URL}${url}`, { data: payload });
      expect(response.ok(), `${url} -> ${String(response.status())}`).toBe(true);
      return (await response.json()) as T;
    };

    // Set up a tournament with an unscheduled, participant-assigned group match.
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
      { name: categoryName, code: categoryCode, format: 'SINGLES' },
    );
    await post(`/api/v1/categories/${category.data.id}/transition`, { status: 'OPEN' });

    const entryIds: string[] = [];
    for (const name of [playerOne, playerTwo]) {
      const player = await post<{ data: Entity }>('/api/v1/players', { name });
      const entry = await post<{ data: Entity }>(`/api/v1/categories/${category.data.id}/entries`, {
        playerId: player.data.id,
      });
      entryIds.push(entry.data.id);
    }

    await post(`/api/v1/tournaments/${tournamentId}/courts`, { number: 1, name: 'Court One' });

    const stage = await post<{ data: Entity }>(`/api/v1/categories/${category.data.id}/stages`, {
      name: 'Group A',
      type: 'GROUP',
      sequence: 1,
    });
    await post(`/api/v1/stages/${stage.data.id}/transition`, { status: 'ACTIVE' });
    const match = await post<{ data: Entity }>(`/api/v1/stages/${stage.data.id}/matches`, {
      sequence: 1,
    });
    const matchId = match.data.id;
    await post(`/api/v1/matches/${matchId}/participants`, { entryId: entryIds[0], slot: 1 });
    await post(`/api/v1/matches/${matchId}/participants`, { entryId: entryIds[1], slot: 2 });

    const dashboardUrl = `/tournaments/${tournamentId}/dashboard`;
    const matchUrl = `/tournaments/${tournamentId}/categories/${category.data.id}/matches/${matchId}`;

    // Browser A: the dashboard loads over REST; the realtime indicator turns
    // "Live" once the EventSource is open, proving the sync path is active.
    await page.goto(dashboardUrl);
    await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-status', 'CONNECTED', {
      timeout: 15_000,
    });

    // The un-scheduled match sits in "Needs scheduling".
    await expect(cardWithTitle(page, 'Needs scheduling').getByText(playerOne)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      cardWithTitle(page, 'Upcoming').getByText('No upcoming scheduled matches.'),
    ).toBeVisible();

    // Browser B: schedule the match on the court through the real UI.
    const pageB = await context.newPage();
    await pageB.goto(matchUrl);
    await pageB.getByLabel('Court').click();
    await pageB.getByRole('option', { name: /Court 1/ }).click();
    await pageB.getByLabel(/^Start/).fill('2026-10-05T10:00');
    await pageB.getByLabel(/^End/).fill('2026-10-05T10:30');
    await pageB.getByRole('button', { name: 'Schedule match' }).click();
    await expect(pageB.getByText('Starts').first()).toBeVisible({ timeout: 15_000 });
    await pageB.close();

    // Browser A: the SSE event triggers an authoritative REST refetch, so the
    // match moves from "Needs scheduling" to "Upcoming" with no manual refresh.
    await expect(cardWithTitle(page, 'Upcoming').getByText(playerOne)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      cardWithTitle(page, 'Needs scheduling').getByText('Every match has a court and time.'),
    ).toBeVisible();
  });
});
