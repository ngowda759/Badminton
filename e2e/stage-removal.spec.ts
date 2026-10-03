import { expect, test } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * TASK-10 / G11 guarded stage removal, against the real UI, API and PostgreSQL.
 *
 * A category is created with two stages. The empty stage is removed through the
 * stages page: it disappears from the list and stays gone after a reload. Group
 * fixtures are then generated for the remaining stage, after which its removal
 * control is disabled and the API refuses the delete with a conflict. Nothing is
 * mocked: every step goes through the running Fastify API and the database.
 *
 * Requires PostgreSQL and migrations (`docker compose up -d postgres` and
 * `npm run db:migrate`), which the Playwright `webServer` block depends on for
 * the API health check.
 */

interface Entity {
  readonly id: string;
}

test.describe('stage removal', () => {
  test('removes an empty stage and refuses a stage that has matches', async ({ page, request }) => {
    const unique = Date.now();
    const tournamentName = `E2E Stage Removal ${unique}`;
    const categoryName = `E2E Removal Cat ${unique}`;
    const categoryCode = `R${String(unique).slice(-4)}`;

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
    for (const index of [1, 2, 3, 4]) {
      const player = await post<{ data: Entity }>('/api/v1/players', {
        name: `E2E Removal Player ${String(index)} ${unique}`,
      });
      const entry = await post<{ data: Entity }>(`/api/v1/categories/${category.data.id}/entries`, {
        playerId: player.data.id,
      });
      entryIds.push(entry.data.id);
    }

    const group = await post<{ data: Entity }>(`/api/v1/categories/${category.data.id}/stages`, {
      name: 'Group A',
      type: 'GROUP',
      sequence: 1,
    });
    await post(`/api/v1/categories/${category.data.id}/stages`, {
      name: 'Empty Stage',
      type: 'GROUP',
      sequence: 2,
    });

    const categoryUrl = `/tournaments/${tournament.data.id}/categories/${category.data.id}`;
    await page.goto(`${categoryUrl}/stages`);

    // --- Remove the empty stage through the UI. -----------------------------
    await expect(page.getByText('Empty Stage')).toBeVisible();
    const emptyRow = page.getByRole('row', { name: /Empty Stage/ });
    await emptyRow.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();

    await expect(page.getByText('Empty Stage')).toHaveCount(0, { timeout: 15_000 });

    // The removal survives a reload.
    await page.reload();
    await expect(page.getByText('Group A')).toBeVisible();
    await expect(page.getByText('Empty Stage')).toHaveCount(0);

    // --- A stage with matches can no longer be removed. ---------------------
    const fixtures = await request.post(`${API_BASE_URL}/api/v1/stages/${group.data.id}/fixtures`, {
      data: { entryIds },
    });
    expect(fixtures.ok(), `fixtures -> ${String(fixtures.status())}`).toBe(true);

    // The API refuses a delete of the now-populated stage.
    const refused = await request.delete(`${API_BASE_URL}/api/v1/stages/${group.data.id}`);
    expect(refused.status()).toBe(409);

    // The UI no longer offers the removal (the control is disabled).
    await page.reload();
    const groupRow = page.getByRole('row', { name: /Group A/ });
    await expect(groupRow.getByRole('button', { name: 'Remove' })).toBeDisabled();

    // The stage is still there.
    await expect(page.getByText('Group A')).toBeVisible();
  });
});
