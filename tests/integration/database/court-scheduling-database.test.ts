import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@badminton/database';
import { ConflictError } from '@badminton/domain';
import { createRepositoryClient } from '@badminton/infrastructure';

import {
  createCategory,
  createCourt,
  createMatch,
  createStage,
  createTournament,
  databaseTestsRequired,
  openTestDatabase,
  resetTournamentData,
} from './harness.ts';

/**
 * Phase 7 database integration tests (real PostgreSQL, no Prisma mocks).
 *
 * They assert the structural guarantees the Phase 7 migration promises: the
 * unique court number per tournament, the schedule-field consistency CHECK, the
 * positive-duration CHECK and - critically - the GiST exclusion constraint that
 * is the final concurrency boundary for overlapping court schedules. Application
 * pre-checks give friendly errors; these tests prove the database cannot be
 * bypassed by two racing writers.
 */

const database = await openTestDatabase('_phase7_test');

afterAll(async () => {
  await database?.disconnect();
});

/** Runs `operation`, asserting it rejects, and returns the error for inspection. */
async function rejection(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected the database to reject the operation, but it succeeded.');
}

const SUITE_NAME = 'Phase 7 court and scheduling database';

function registerDatabaseSuite(prisma: PrismaClient): void {
  const repositories = createRepositoryClient(prisma);

  describe(SUITE_NAME, () => {
    beforeEach(async () => {
      await resetTournamentData(prisma);
    });

    describe('court removal boundary', () => {
      it('deletes a court with no matches', async () => {
        const tournament = await createTournament(prisma);
        const court = await createCourt(prisma, { tournamentId: tournament.id, number: 1 });

        await repositories.courts.remove(court.id);

        const rows = await prisma.court.findMany({ where: { tournamentId: tournament.id } });
        expect(rows).toHaveLength(0);
      });

      it('rejects removing a court that still has a match and translates the FK failure', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const stage = await createStage(prisma, { categoryId: category.id });
        const court = await createCourt(prisma, { tournamentId: tournament.id, number: 1 });
        await createMatch(prisma, {
          stageId: stage.id,
          courtId: court.id,
          scheduledStartAt: new Date('2026-10-05T10:00:00.000Z'),
          scheduledEndAt: new Date('2026-10-05T10:30:00.000Z'),
        });

        const error = await repositories.courts.remove(court.id).then(
          () => undefined,
          (caught: unknown) => caught,
        );

        expect(error).toBeInstanceOf(ConflictError);
        // The raw driver message (constraint name / SQL) must not leak.
        expect(String(error)).not.toContain('matches_courtId_fkey');

        const rows = await prisma.court.findMany({ where: { id: court.id } });
        expect(rows).toHaveLength(1);
      });
    });

    describe('court uniqueness', () => {
      it('rejects a duplicate court number within a tournament', async () => {
        const tournament = await createTournament(prisma);
        await createCourt(prisma, { tournamentId: tournament.id, number: 1 });
        const error = await rejection(
          createCourt(prisma, { tournamentId: tournament.id, number: 1 }),
        );
        expect(String(error)).toContain('courts_tournamentId_number_key');
      });

      it('allows the same court number in different tournaments', async () => {
        const first = await createTournament(prisma, { name: 'First' });
        const second = await createTournament(prisma, { name: 'Second' });
        await createCourt(prisma, { tournamentId: first.id, number: 1 });
        const court = await createCourt(prisma, { tournamentId: second.id, number: 1 });
        expect(court.number).toBe(1);
      });

      it('rejects a non-positive court number', async () => {
        const tournament = await createTournament(prisma);
        const error = await rejection(
          createCourt(prisma, { tournamentId: tournament.id, number: 0 }),
        );
        expect(String(error)).toContain('courts_number_positive');
      });
    });

    describe('schedule field consistency', () => {
      it('rejects a partially scheduled match', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const stage = await createStage(prisma, { categoryId: category.id });
        const court = await createCourt(prisma, { tournamentId: tournament.id });

        const error = await rejection(
          createMatch(prisma, {
            stageId: stage.id,
            courtId: court.id,
            scheduledStartAt: new Date('2026-10-05T10:00:00.000Z'),
            scheduledEndAt: null,
          }),
        );
        expect(String(error)).toContain('matches_schedule_fields_consistent');
      });

      it('rejects a zero or reversed interval', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const stage = await createStage(prisma, { categoryId: category.id });
        const court = await createCourt(prisma, { tournamentId: tournament.id });

        const error = await rejection(
          createMatch(prisma, {
            stageId: stage.id,
            courtId: court.id,
            scheduledStartAt: new Date('2026-10-05T10:30:00.000Z'),
            scheduledEndAt: new Date('2026-10-05T10:00:00.000Z'),
          }),
        );
        expect(String(error)).toContain('matches_schedule_range_valid');
      });
    });

    describe('court schedule overlap protection', () => {
      it('rejects an overlapping match on the same court', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const stage = await createStage(prisma, { categoryId: category.id });
        const court = await createCourt(prisma, { tournamentId: tournament.id });

        await createMatch(prisma, {
          stageId: stage.id,
          sequence: 1,
          courtId: court.id,
          scheduledStartAt: new Date('2026-10-05T10:00:00.000Z'),
          scheduledEndAt: new Date('2026-10-05T10:30:00.000Z'),
        });

        const error = await rejection(
          createMatch(prisma, {
            stageId: stage.id,
            sequence: 2,
            courtId: court.id,
            scheduledStartAt: new Date('2026-10-05T10:15:00.000Z'),
            scheduledEndAt: new Date('2026-10-05T10:45:00.000Z'),
          }),
        );
        expect(String(error)).toContain('matches_court_schedule_no_overlap');
      });

      it('allows back-to-back matches that only touch', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const stage = await createStage(prisma, { categoryId: category.id });
        const court = await createCourt(prisma, { tournamentId: tournament.id });

        await createMatch(prisma, {
          stageId: stage.id,
          sequence: 1,
          courtId: court.id,
          scheduledStartAt: new Date('2026-10-05T10:00:00.000Z'),
          scheduledEndAt: new Date('2026-10-05T10:30:00.000Z'),
        });
        const second = await createMatch(prisma, {
          stageId: stage.id,
          sequence: 2,
          courtId: court.id,
          scheduledStartAt: new Date('2026-10-05T10:30:00.000Z'),
          scheduledEndAt: new Date('2026-10-05T11:00:00.000Z'),
        });
        expect(second.id).toBeTruthy();
      });

      it('allows overlapping windows on different courts', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const stage = await createStage(prisma, { categoryId: category.id });
        const court1 = await createCourt(prisma, { tournamentId: tournament.id, number: 1 });
        const court2 = await createCourt(prisma, { tournamentId: tournament.id, number: 2 });

        await createMatch(prisma, {
          stageId: stage.id,
          sequence: 1,
          courtId: court1.id,
          scheduledStartAt: new Date('2026-10-05T10:00:00.000Z'),
          scheduledEndAt: new Date('2026-10-05T10:30:00.000Z'),
        });
        const second = await createMatch(prisma, {
          stageId: stage.id,
          sequence: 2,
          courtId: court2.id,
          scheduledStartAt: new Date('2026-10-05T10:00:00.000Z'),
          scheduledEndAt: new Date('2026-10-05T10:30:00.000Z'),
        });
        expect(second.id).toBeTruthy();
      });

      it('rejects an overlapping match under a concurrent-style insert race', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const stage = await createStage(prisma, { categoryId: category.id });
        const court = await createCourt(prisma, { tournamentId: tournament.id });

        const window = {
          courtId: court.id,
          scheduledStartAt: new Date('2026-10-05T10:00:00.000Z'),
          scheduledEndAt: new Date('2026-10-05T10:30:00.000Z'),
        };

        // Both writes race for the same court window; the exclusion constraint
        // must let exactly one commit.
        const results = await Promise.allSettled([
          createMatch(prisma, { stageId: stage.id, sequence: 1, ...window }),
          createMatch(prisma, { stageId: stage.id, sequence: 2, ...window }),
        ]);

        const fulfilled = results.filter((result) => result.status === 'fulfilled');
        const rejected = results.filter((result) => result.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
      });
    });

    describe('unscheduled matches', () => {
      it('allows many unscheduled matches', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const stage = await createStage(prisma, { categoryId: category.id });
        const first = await createMatch(prisma, { stageId: stage.id, sequence: 1 });
        const second = await createMatch(prisma, { stageId: stage.id, sequence: 2 });
        expect(first.id).not.toBe(second.id);
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
