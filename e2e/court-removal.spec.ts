import { expect, test } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * TASK-11 / G11 guarded court removal, against the real UI, API and PostgreSQL.
 *
 * A tournament is created with two courts. The empty court is removed through
 * the courts page: it disappears from the list and stays gone after a reload. A
 * match is then scheduled on the remaining court, after which its removal
 * control is disabled and the API refuses the delete with a conflict. The
 * last-court refusal is exercised at the API level. Nothing is mocked: every
 * step goes through the running Fastify API and the database.
 *
 * Requires PostgreSQL and migrations (`docker compose up -d postgres` and
 * `npm run db:migrate`), which the Playwright `webServer` block depends on for
 * the API health check.
 */

interface Entity {
  readonly id: string;
}

test.describe('court removal', () => {
  test('removes an empty court and refuses a court that has a match', async ({ page, request }) => {
    const unique = Date.now();
    const tournamentName = `E2E Court Removal ${unique}`;
    const categoryName = `E2E Removal Cat ${unique}`;
    const categoryCode = `K${String(unique).slice(-4)}`;

    const post = async <T>(url: string, payload: unknown): Promise<T> => {
      const response = await request.post(`${API_BASE_URL}${url}`, { data: payload });
      expect(response.ok(), `${url} -> ${String(response.status())}`).toBe(true);
      return (await response.json()) as T;
    };

    // --- Setup over the API so the test focuses on the removal UI. ----------
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
    for (const index of [1, 2]) {
      const player = await post<{ data: Entity }>('/api/v1/players', {
        name: `E2E Court Player ${String(index)} ${unique}`,
      });
      const entry = await post<{ data: Entity }>(`/api/v1/categories/${category.data.id}/entries`, {
        playerId: player.data.id,
      });
      entryIds.push(entry.data.id);
    }

    // Two courts; the second is the empty one to remove.
    const courtOne = await post<{ data: Entity }>(
      `/api/v1/tournaments/${tournament.data.id}/courts`,
      { number: 1, name: 'Court One' },
    );
    const removable = await post<{ data: Entity }>(
      `/api/v1/tournaments/${tournament.data.id}/courts`,
      { number: 2, name: 'Court Two' },
    );

    const manageUrl = `/tournaments/${tournament.data.id}/courts/manage`;
    await page.goto(manageUrl);

    // --- Remove the empty court through the UI. -----------------------------
    await expect(page.getByText('Court Two')).toBeVisible();
    const emptyRow = page.getByRole('row', { name: /Court Two/ });
    await emptyRow.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();

    await expect(page.getByText('Court Two')).toHaveCount(0, { timeout: 15_000 });

    // The removal survives a reload.
    await page.reload();
    await expect(page.getByText('Court One')).toBeVisible();
    await expect(page.getByText('Court Two')).toHaveCount(0);

    // --- A court with a match can no longer be removed. ---------------------
    const stage = await post<{ data: Entity }>(`/api/v1/categories/${category.data.id}/stages`, {
      name: 'Group A',
      type: 'GROUP',
      sequence: 1,
    });
    const match = await post<{ data: Entity }>(`/api/v1/stages/${stage.data.id}/matches`, {
      sequence: 1,
    });
    await post(`/api/v1/matches/${match.data.id}/participants`, {
      entryId: entryIds[0] as string,
      slot: 1,
    });
    await post(`/api/v1/matches/${match.data.id}/participants`, {
      entryId: entryIds[1] as string,
      slot: 2,
    });
    await post(`/api/v1/matches/${match.data.id}/schedule`, {
      courtId: courtOne.data.id,
      scheduledStartAt: '2026-10-05T10:00:00.000Z',
      scheduledEndAt: '2026-10-05T10:30:00.000Z',
    });

    // Add an empty third court so the occupied court is **not** the tournament's
    // last court: the disabled control below must be driven by occupancy, not by
    // the last-court guard.
    await post(`/api/v1/tournaments/${tournament.data.id}/courts`, {
      number: 3,
      name: 'Court Three',
    });

    // The API refuses a delete of the now-occupied court.
    const refused = await request.delete(`${API_BASE_URL}/api/v1/courts/${courtOne.data.id}`);
    expect(refused.status()).toBe(409);

    // The UI no longer offers the removal (the control is disabled because the
    // court is occupied, even though another empty court remains).
    await page.reload();
    const occupiedRow = page.getByRole('row', { name: /Court One/ });
    await expect(occupiedRow.getByRole('button', { name: 'Remove' })).toBeDisabled();
    await expect(page.getByRole('row', { name: /Court Three/ })).toBeVisible();

    // The court is still there.
    await expect(page.getByText('Court One')).toBeVisible();

    // The earlier empty court is already gone, so removing it again is a 404.
    const gone = await request.delete(`${API_BASE_URL}/api/v1/courts/${removable.data.id}`);
    expect(gone.status()).toBe(404);

    // --- The last-court refusal is exercised at the API level. --------------
    const loneTournament = await post<{ data: Entity }>('/api/v1/tournaments', {
      name: `E2E Lone Court ${unique}`,
      startDate: '2026-10-01',
      endDate: '2026-10-05',
      timezone: 'Asia/Kolkata',
    });
    const loneCourt = await post<{ data: Entity }>(
      `/api/v1/tournaments/${loneTournament.data.id}/courts`,
      { number: 1, name: 'Only Court' },
    );
    const lastRefused = await request.delete(`${API_BASE_URL}/api/v1/courts/${loneCourt.data.id}`);
    expect(lastRefused.status()).toBe(422);
  });
});
