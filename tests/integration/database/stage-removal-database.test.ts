import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@badminton/database';
import { ConflictError } from '@badminton/domain';
import { createRepositoryClient } from '@badminton/infrastructure';

import {
  createCategory,
  createMatch,
  createStage,
  createTournament,
  databaseTestsRequired,
  openTestDatabase,
  resetTournamentData,
} from './harness.ts';

/**
 * Guarded stage removal against real PostgreSQL.
 *
 * The service pre-checks a stage for matches, but the `matches.stageId`
 * `onDelete: Restrict` constraint is the final boundary: even a delete that
 * bypasses the pre-check must fail, and the infrastructure adapter must
 * translate the referential failure into a domain `ConflictError` rather than
 * leaking a raw SQL error.
 */

const database = await openTestDatabase('_stage_removal_test');

afterAll(async () => {
  await database?.disconnect();
});

const SUITE_NAME = 'Stage removal database';

function registerDatabaseSuite(prisma: PrismaClient): void {
  const repositories = createRepositoryClient(prisma);

  describe(SUITE_NAME, () => {
    beforeEach(async () => {
      await resetTournamentData(prisma);
    });

    it('deletes an empty stage', async () => {
      const tournament = await createTournament(prisma);
      const category = await createCategory(prisma, { tournamentId: tournament.id });
      const stage = await createStage(prisma, { categoryId: category.id, sequence: 1 });

      await repositories.stages.remove(stage.id);

      const rows = await prisma.tournamentStage.findMany({ where: { categoryId: category.id } });
      expect(rows).toHaveLength(0);
    });

    it('rejects removing a stage that still has a match and translates the FK failure', async () => {
      const tournament = await createTournament(prisma);
      const category = await createCategory(prisma, { tournamentId: tournament.id });
      const stage = await createStage(prisma, { categoryId: category.id, sequence: 1 });
      await createMatch(prisma, { stageId: stage.id, sequence: 1 });

      const error = await repositories.stages.remove(stage.id).then(
        () => undefined,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(ConflictError);
      // The raw driver message (constraint name / SQL) must not leak.
      expect(String(error)).not.toContain('matches_stageId_fkey');

      const rows = await prisma.tournamentStage.findMany({ where: { id: stage.id } });
      expect(rows).toHaveLength(1);
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
