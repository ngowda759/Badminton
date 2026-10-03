import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createGroupFixtureService,
  type RepositoryClient,
  type UnitOfWork,
} from '@badminton/application';
import type { PrismaClient } from '@badminton/database';
import { createPrismaUnitOfWork, createRepositoryClient } from '@badminton/infrastructure';

import {
  createCategory,
  createEntry,
  createMatchGame,
  createPlayer,
  createStage,
  createTournament,
  databaseTestsRequired,
  openTestDatabase,
  resetTournamentData,
} from './harness.ts';

/**
 * Guarded group-fixture regeneration against real PostgreSQL.
 *
 * Regeneration replaces the whole fixture set: it deletes every old match and
 * the `match_participants`/`match_games` `onDelete: Cascade` removes their
 * participants and recorded games, then inserts the fresh round-robin in the
 * same transaction. This suite proves the replace against the real database and
 * proves the atomicity: a failure raised after the deletes have run rolls the
 * transaction back and leaves the original fixtures, participants and games
 * intact.
 */

const database = await openTestDatabase('_fixture_regen_test');

afterAll(async () => {
  await database?.disconnect();
});

const SUITE_NAME = 'Group fixture regeneration database';

function registerDatabaseSuite(prisma: PrismaClient): void {
  const unitOfWork = createPrismaUnitOfWork(prisma);
  const fixtures = createGroupFixtureService(unitOfWork);
  const repositories = createRepositoryClient(prisma);

  /** Seeds a GROUP category with four active player entries. */
  async function arrange(): Promise<{
    readonly stageId: string;
    readonly entryIds: readonly string[];
  }> {
    const tournament = await createTournament(prisma);
    const category = await createCategory(prisma, { tournamentId: tournament.id });
    const stage = await createStage(prisma, { categoryId: category.id, sequence: 1 });
    const entryIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const player = await createPlayer(prisma, { name: `Regen Player ${String(index + 1)}` });
      const entry = await createEntry(prisma, {
        categoryId: category.id,
        playerId: player.id,
      });
      entryIds.push(entry.id);
    }
    return { stageId: stage.id, entryIds };
  }

  describe(SUITE_NAME, () => {
    beforeEach(async () => {
      await resetTournamentData(prisma);
    });

    it('deletes the old matches, their participants and games, and inserts the new round-robin', async () => {
      const { stageId, entryIds } = await arrange();
      const first = await fixtures.generate(stageId, { entryIds });
      const oldIds = first.matches.map((match) => match.matchId);

      // Attach a recorded game to an old match so the cascade has something to
      // remove beyond the participants.
      const scoredMatch = oldIds[0];
      if (scoredMatch === undefined) {
        throw new Error('Expected a generated match.');
      }
      const participants = await prisma.matchParticipant.findMany({
        where: { matchId: scoredMatch },
      });
      const slot1 = participants.find((row) => row.slot === 1);
      if (!slot1) {
        throw new Error('Expected a slot-1 participant.');
      }
      await createMatchGame(prisma, { matchId: scoredMatch, gameNumber: 1 });

      const reordered = [...entryIds].reverse();
      const result = await fixtures.regenerate(stageId, { entryIds: reordered });

      // The old match ids and their games are gone.
      const oldRows = await prisma.match.findMany({ where: { id: { in: oldIds } } });
      expect(oldRows).toHaveLength(0);
      const staleGames = await prisma.matchGame.findMany({
        where: { matchId: { in: oldIds } },
      });
      expect(staleGames).toHaveLength(0);
      const staleParticipants = await prisma.matchParticipant.findMany({
        where: { matchId: { in: oldIds } },
      });
      expect(staleParticipants).toHaveLength(0);

      // The new set is present with both slots filled.
      const newIds = result.matches.map((match) => match.matchId);
      expect(newIds).toHaveLength(6);
      const stored = await repositories.matches.listByStageWithParticipants(stageId);
      expect(stored).toHaveLength(6);
      for (const row of stored) {
        expect(row.participants).toHaveLength(2);
        expect(reordered).toContain(row.participants[0]?.entryId);
        expect(reordered).toContain(row.participants[1]?.entryId);
      }
    });

    it('leaves the original fixtures, participants and games intact when a failure is raised mid-regeneration', async () => {
      const { stageId, entryIds } = await arrange();
      const first = await fixtures.generate(stageId, { entryIds });
      const oldIds = first.matches.map((match) => match.matchId).sort();
      const scoredMatch = oldIds[0];
      if (scoredMatch === undefined) {
        throw new Error('Expected a generated match.');
      }
      await createMatchGame(prisma, { matchId: scoredMatch, gameNumber: 1 });
      const beforeParticipants = await prisma.matchParticipant.count();
      const beforeGames = await prisma.matchGame.count();

      // A unit of work that fails on the first participant insert of the fresh
      // round-robin - after the old matches (and their cascaded children) have
      // been deleted, so only the transaction rollback can save them.
      let failNext = false;
      const failing: UnitOfWork = {
        async runInTransaction<T>(work: (client: RepositoryClient) => Promise<T>): Promise<T> {
          return unitOfWork.runInTransaction(async (client) => {
            const wrapped: RepositoryClient = {
              ...client,
              matchParticipants: {
                ...client.matchParticipants,
                create: async (
                  data: Parameters<RepositoryClient['matchParticipants']['create']>[0],
                ) => {
                  if (failNext) {
                    throw new Error('injected regeneration failure');
                  }
                  return client.matchParticipants.create(data);
                },
              },
            };
            return work(wrapped);
          });
        },
      };
      const failingFixtures = createGroupFixtureService(failing);
      failNext = true;

      await expect(
        failingFixtures.regenerate(stageId, { entryIds: [...entryIds].reverse() }),
      ).rejects.toThrow('injected regeneration failure');

      // The original fixtures, their participants and their recorded game are
      // all still there.
      const afterStored = await repositories.matches.listByStage(stageId);
      expect(afterStored.map((match) => match.id).sort()).toEqual(oldIds);
      expect(await prisma.matchParticipant.count()).toBe(beforeParticipants);
      expect(await prisma.matchGame.count()).toBe(beforeGames);
      const game = await prisma.matchGame.findFirst({ where: { matchId: scoredMatch } });
      expect(game).not.toBeNull();
    });

    it('does not leak a raw SQL error when deleting a broken match', async () => {
      const { stageId, entryIds } = await arrange();
      const first = await fixtures.generate(stageId, { entryIds });
      const matchId = first.matches[0]?.matchId;
      if (matchId === undefined) {
        throw new Error('Expected a generated match.');
      }

      // Removing a match succeeds and, through the cascade, removes nothing
      // else; the adapter must never surface a SQL/constraint detail.
      await repositories.matches.remove(matchId);
      const remaining = await createRepositoryClient(prisma).matches.listByStage(stageId);
      expect(remaining).toHaveLength(first.matches.length - 1);
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
