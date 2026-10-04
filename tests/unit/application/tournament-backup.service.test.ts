import { createTournamentBackupService } from '@badminton/application';
import { NotFoundError } from '@badminton/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import {
  seedCategory,
  seedCourt,
  seedMatch,
  seedPlayer,
  seedStage,
  seedTournament,
} from './fixtures.ts';

/**
 * Tournament backup export (TASK-13, G9).
 *
 * Export is a pure read assembled from the existing per-tournament repository
 * reads: the whole tournament is returned in one derived value, each aggregate
 * is read once (never per match) and nothing is written - no transaction, no
 * realtime event.
 */

let repos: FakeRepositories;
let backup: ReturnType<typeof createTournamentBackupService>;

beforeEach(() => {
  repos = createFakeRepositories();
  backup = createTournamentBackupService(repos.client);
});

interface Seeded {
  readonly tournamentId: string;
  readonly categoryId: string;
  readonly stageId: string;
  readonly courtId: string;
  readonly matchId: string;
  readonly entryIds: readonly string[];
}

/** A tournament with one category, stage, court, two entries, a match and a game. */
async function seedFullTournament(): Promise<Seeded> {
  const tournamentId = await seedTournament(repos.client);
  const categoryId = await seedCategory(repos.client, { tournamentId });
  const stageId = await seedStage(repos.client, categoryId);
  const courtId = await seedCourt(repos.client, tournamentId);
  const playerA = await seedPlayer(repos.client, 'A');
  const playerB = await seedPlayer(repos.client, 'B');
  const entryA = await repos.client.entries.create({
    categoryId,
    playerId: playerA,
    teamId: null,
    seed: null,
    status: 'CONFIRMED',
  });
  const entryB = await repos.client.entries.create({
    categoryId,
    playerId: playerB,
    teamId: null,
    seed: null,
    status: 'CONFIRMED',
  });
  const matchId = await seedMatch(repos.client, stageId);
  await repos.client.matchParticipants.create({ matchId, entryId: entryA.id, slot: 1 });
  await repos.client.matchParticipants.create({ matchId, entryId: entryB.id, slot: 2 });
  await repos.client.matchGames.createMany([
    { matchId, gameNumber: 1, participant1Points: 21, participant2Points: 15, winnerSlot: 1 },
  ]);
  return { tournamentId, categoryId, stageId, courtId, matchId, entryIds: [entryA.id, entryB.id] };
}

describe('TournamentBackupService.export', () => {
  it('returns the tournament with its categories, stages, courts, entries, matches, participants and games', async () => {
    const seeded = await seedFullTournament();

    const result = await backup.export(seeded.tournamentId);

    expect(result.tournament.id).toBe(seeded.tournamentId);
    expect(result.categories.map((category) => category.id)).toEqual([seeded.categoryId]);
    expect(result.stages.map((stage) => stage.id)).toEqual([seeded.stageId]);
    expect(result.courts.map((court) => court.id)).toEqual([seeded.courtId]);
    expect([...result.entries.map((entry) => entry.id)].sort()).toEqual(
      [...seeded.entryIds].sort(),
    );
    expect(result.matches.map((match) => match.id)).toEqual([seeded.matchId]);
    expect([...result.participants.map((participant) => participant.entryId)].sort()).toEqual(
      [...seeded.entryIds].sort(),
    );
    expect(result.games).toHaveLength(1);
    expect(result.games[0]).toMatchObject({
      matchId: seeded.matchId,
      gameNumber: 1,
      participant1Points: 21,
      participant2Points: 15,
    });
  });

  it('reads each aggregate once for the whole tournament and never per match', async () => {
    const { tournamentId } = await seedFullTournament();

    const matchesRead = vi.spyOn(repos.client.matches, 'listByTournament');
    const participantsRead = vi.spyOn(repos.client.matchParticipants, 'listByMatchIds');
    const gamesRead = vi.spyOn(repos.client.matchGames, 'listByMatchIds');
    const perMatchParticipants = vi.spyOn(repos.client.matchParticipants, 'listByMatch');
    const perMatchGames = vi.spyOn(repos.client.matchGames, 'listByMatch');

    await backup.export(tournamentId);

    expect(matchesRead).toHaveBeenCalledTimes(1);
    expect(participantsRead).toHaveBeenCalledTimes(1);
    expect(gamesRead).toHaveBeenCalledTimes(1);
    // No per-match fan-out: the batched reads carry every match at once.
    expect(perMatchParticipants).not.toHaveBeenCalled();
    expect(perMatchGames).not.toHaveBeenCalled();
  });

  it('raises NotFoundError for an unknown tournament id', async () => {
    await expect(backup.export('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('records no realtime event (it is a pure read)', async () => {
    const { tournamentId } = await seedFullTournament();
    const before = await repos.client.realtimeEvents.getPendingEvents(100);

    await backup.export(tournamentId);

    expect(await repos.client.realtimeEvents.getPendingEvents(100)).toEqual(before);
  });
});
