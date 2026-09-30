import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { ListPage, RepositoryClient } from '@badminton/application';
import type { PrismaClient } from '@badminton/database';
import { createRepositoryClient } from '@badminton/infrastructure';

import { databaseTestsRequired, openTestDatabase, resetTournamentData } from './harness.ts';

/**
 * Cursor-pagination integration tests (real PostgreSQL, no Prisma mocks).
 *
 * The repository orders every collection by `(createdAt desc, id desc)` and
 * paginates with a Prisma `cursor: { id }` plus `skip: 1`. Prisma expands that
 * cursor into a keyset predicate over the *whole* ordering tuple (it looks the
 * cursor row's `createdAt` up in a subquery), so the page resumes strictly after
 * the cursor even when `createdAt` values differ. These tests prove that against
 * real PostgreSQL with rows whose `createdAt` values are explicitly distinct,
 * tied and interleaved - something the in-memory fake cannot exercise because it
 * stamps every row with one fixed timestamp.
 *
 * The suite talks to a dedicated `<database>_collections_test` database, so it
 * never collides with the other database suites, which mutate the same tables.
 */

const database = await openTestDatabase('_collections_test');

afterAll(async () => {
  await database?.disconnect();
});

const SUITE_NAME = 'Collection cursor pagination (database)';

/** A pageable read returning rows that carry at least an id and createdAt. */
type PageReader<T> = (cursor: string | undefined) => Promise<ListPage<T>>;

/**
 * Walks every page via `nextCursor`, guarding against a non-terminating cursor.
 * Returns the concatenated rows in the order they were served.
 */
async function collectAll<T>(read: PageReader<T>): Promise<readonly T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await read(cursor);
    rows.push(...result.items);
    if (result.nextCursor === null) {
      return rows;
    }
    cursor = result.nextCursor;
  }
  throw new Error('Cursor pagination did not terminate.');
}

/**
 * Asserts the rows are in strict newest-first order: `createdAt` non-increasing,
 * and for equal timestamps `id` strictly descending (the tiebreaker).
 */
function expectNewestFirst(rows: readonly { id: string; createdAt: Date }[]): void {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const previousTime = previous.createdAt.getTime();
    const currentTime = current.createdAt.getTime();
    expect(currentTime).toBeLessThanOrEqual(previousTime);
    if (currentTime === previousTime) {
      expect(current.id < previous.id).toBe(true);
    }
  }
}

/** The unique ids of `rows`, in order. */
function ids(rows: readonly { id: string }[]): readonly string[] {
  return rows.map((row) => row.id);
}

/** Expected id order for a dataset under `(createdAt desc, id desc)`. */
function newestFirstIds(rows: readonly { id: string; createdAt: Date }[]): readonly string[] {
  return [...rows]
    .sort((left, right) => {
      const byTime = right.createdAt.getTime() - left.createdAt.getTime();
      return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
    })
    .map((row) => row.id);
}

interface Fixture {
  readonly id: string;
  readonly createdAt: Date;
}

function registerDatabaseSuite(prisma: PrismaClient): void {
  const repositories: RepositoryClient = createRepositoryClient(prisma);

  const createTournament = (name: string, createdAt: Date): Promise<Fixture> =>
    prisma.tournament.create({
      data: {
        name,
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        endDate: new Date('2026-02-03T00:00:00.000Z'),
        timezone: 'Asia/Kolkata',
        status: 'DRAFT',
        createdAt,
      },
      select: { id: true, createdAt: true },
    });

  const createPlayer = (name: string, createdAt: Date): Promise<Fixture> =>
    prisma.player.create({ data: { name, createdAt }, select: { id: true, createdAt: true } });

  const createTeam = (name: string, createdAt: Date): Promise<Fixture> =>
    prisma.team.create({ data: { name, createdAt }, select: { id: true, createdAt: true } });

  describe(SUITE_NAME, () => {
    beforeEach(async () => {
      await resetTournamentData(prisma);
    });

    describe('tournaments', () => {
      it('orders strictly newest-first across differing createdAt values', async () => {
        const rows = [
          await createTournament('A', new Date('2026-01-05T00:00:00.000Z')),
          await createTournament('B', new Date('2026-01-03T00:00:00.000Z')),
          await createTournament('C', new Date('2026-01-06T00:00:00.000Z')),
          await createTournament('D', new Date('2026-01-01T00:00:00.000Z')),
          await createTournament('E', new Date('2026-01-04T00:00:00.000Z')),
        ];

        const all = await collectAll((cursor) =>
          repositories.tournaments.listPage({ limit: 100, ...(cursor ? { cursor } : {}) }),
        );

        expectNewestFirst(all);
        expect(ids(all)).toEqual(newestFirstIds(rows));
      });

      it('crosses a page boundary between two different createdAt values without skipping or duplicating', async () => {
        // Three newer rows share timestamp X; three older rows share Y. With
        // limit 2 every page boundary falls either inside a tie or between the
        // two timestamps, so a broken keyset predicate would show up as a skip
        // or a repeat at the X/Y seam.
        const newerTime = new Date('2026-01-05T00:00:00.000Z');
        const olderTime = new Date('2026-01-02T00:00:00.000Z');
        const newer = [
          await createTournament('X1', newerTime),
          await createTournament('X2', newerTime),
          await createTournament('X3', newerTime),
        ];
        const older = [
          await createTournament('Y1', olderTime),
          await createTournament('Y2', olderTime),
          await createTournament('Y3', olderTime),
        ];
        const rows = [...newer, ...older];

        const pages: string[][] = [];
        let cursor: string | undefined;
        for (let index = 0; index < 10; index += 1) {
          const page = await repositories.tournaments.listPage({
            limit: 2,
            ...(cursor ? { cursor } : {}),
          });
          pages.push([...ids(page.items)]);
          if (page.nextCursor === null) {
            break;
          }
          cursor = page.nextCursor;
        }

        const expected = newestFirstIds(rows);
        // Pages are consecutive slices of the single deterministic ordering.
        expect(pages.flat()).toEqual(expected);
        // 6 rows at limit 2 => three pages; the seam is crossed mid-traversal.
        expect(pages).toHaveLength(3);
        // Page 1 straddles the timestamp seam: exactly one newer and one older
        // row. A keyset predicate that only compared createdAt would drop or
        // repeat a row here.
        const newerIds = new Set(newer.map((row) => row.id));
        const olderIds = new Set(older.map((row) => row.id));
        const seamPage = pages[1] ?? [];
        expect(seamPage.filter((id) => newerIds.has(id))).toHaveLength(1);
        expect(seamPage.filter((id) => olderIds.has(id))).toHaveLength(1);
      });

      it('keeps records with an identical createdAt complete and deterministic', async () => {
        const sameTime = new Date('2026-01-07T00:00:00.000Z');
        const rows = [
          await createTournament('T1', sameTime),
          await createTournament('T2', sameTime),
          await createTournament('T3', sameTime),
          await createTournament('T4', sameTime),
          await createTournament('T5', sameTime),
        ];

        const all = await collectAll((cursor) =>
          repositories.tournaments.listPage({ limit: 2, ...(cursor ? { cursor } : {}) }),
        );

        // All timestamps equal, so the id tiebreaker alone fixes the order.
        expectNewestFirst(all);
        expect(ids(all)).toEqual(newestFirstIds(rows));
      });

      it('traverses multiple pages with no duplicates and no skipped records', async () => {
        const rows = [
          await createTournament('A', new Date('2026-01-05T00:00:00.000Z')),
          await createTournament('B', new Date('2026-01-03T00:00:00.000Z')),
          await createTournament('C', new Date('2026-01-05T00:00:00.000Z')),
          await createTournament('D', new Date('2026-01-01T00:00:00.000Z')),
          await createTournament('E', new Date('2026-01-04T00:00:00.000Z')),
          await createTournament('F', new Date('2026-01-05T00:00:00.000Z')),
          await createTournament('G', new Date('2026-01-02T00:00:00.000Z')),
        ];

        const all = await collectAll((cursor) =>
          repositories.tournaments.listPage({ limit: 3, ...(cursor ? { cursor } : {}) }),
        );

        const unique = new Set(ids(all));
        expect(all).toHaveLength(rows.length);
        expect(unique.size).toBe(rows.length);
        expect([...unique].sort()).toEqual([...ids(rows)].sort());
        expect(ids(all)).toEqual(newestFirstIds(rows));
      });

      it('returns a null nextCursor only on the final page', async () => {
        const sameTime = new Date('2026-01-09T00:00:00.000Z');
        for (let index = 0; index < 5; index += 1) {
          await createTournament(`Row ${index}`, sameTime);
        }

        const cursors: (string | null)[] = [];
        let cursor: string | undefined;
        for (let index = 0; index < 10; index += 1) {
          const page = await repositories.tournaments.listPage({
            limit: 2,
            ...(cursor ? { cursor } : {}),
          });
          cursors.push(page.nextCursor);
          if (page.nextCursor === null) {
            break;
          }
          cursor = page.nextCursor;
        }

        // 5 rows at limit 2 => pages of 2, 2, 1; only the last has no cursor.
        expect(cursors).toEqual([expect.any(String), expect.any(String), null]);
      });

      it('does not repeat the cursor row and surfaces a newly created row first', async () => {
        const older = await createTournament('Older', new Date('2026-01-01T00:00:00.000Z'));
        const newer = await createTournament('Newer', new Date('2026-01-08T00:00:00.000Z'));

        const firstPage = await repositories.tournaments.listPage({ limit: 1 });
        expect(ids(firstPage.items)).toEqual([newer.id]);
        expect(firstPage.nextCursor).toBe(newer.id);

        // The second page resumes strictly after the cursor, never repeating it.
        const cursor = firstPage.nextCursor;
        expect(cursor).not.toBeNull();
        const secondPage = await repositories.tournaments.listPage({
          limit: 1,
          ...(cursor ? { cursor } : {}),
        });
        expect(ids(secondPage.items)).toEqual([older.id]);
        expect(secondPage.nextCursor).toBeNull();
      });
    });

    describe('players and teams reuse the same cursor mechanism', () => {
      it('pages players across differing createdAt values with no gaps', async () => {
        const rows = [
          await createPlayer('A', new Date('2026-01-05T00:00:00.000Z')),
          await createPlayer('B', new Date('2026-01-02T00:00:00.000Z')),
          await createPlayer('C', new Date('2026-01-05T00:00:00.000Z')),
          await createPlayer('D', new Date('2026-01-01T00:00:00.000Z')),
        ];

        const all = await collectAll((cursor) =>
          repositories.players.listPage({ limit: 2, ...(cursor ? { cursor } : {}) }),
        );

        expectNewestFirst(all);
        expect(ids(all)).toEqual(newestFirstIds(rows));
      });

      it('pages teams across differing createdAt values with no gaps', async () => {
        const rows = [
          await createTeam('A', new Date('2026-01-05T00:00:00.000Z')),
          await createTeam('B', new Date('2026-01-02T00:00:00.000Z')),
          await createTeam('C', new Date('2026-01-05T00:00:00.000Z')),
          await createTeam('D', new Date('2026-01-01T00:00:00.000Z')),
        ];

        const all = await collectAll((cursor) =>
          repositories.teams.listPageWithMemberCount({
            limit: 2,
            ...(cursor ? { cursor } : {}),
          }),
        );

        expectNewestFirst(all.map((row) => row.team));
        expect(ids(all.map((row) => row.team))).toEqual(newestFirstIds(rows));
      });
    });
  });
}

if (database) {
  registerDatabaseSuite(database.prisma);
} else {
  describe.skip(`${SUITE_NAME} (skipped: no database)`, () => {
    it('requires PostgreSQL', () => {
      expect(databaseTestsRequired()).toBe(false);
    });
  });
}
