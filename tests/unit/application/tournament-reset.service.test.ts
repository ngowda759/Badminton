import {
  createRealtimeEventService,
  createTournamentResetService,
  type RepositoryClient,
  type UnitOfWork,
} from '@badminton/application';
import { ConflictError, NotFoundError } from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

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
 * Guarded tournament reset (TASK-13, G9).
 *
 * Reset clears every match's result and schedule and reopens every ACTIVE or
 * COMPLETED stage to PENDING, in exactly one transaction, while leaving the
 * setup (entries, categories, courts) untouched. A terminal tournament is
 * refused and a second reset is idempotent.
 */

interface CountingUnitOfWork {
  readonly unitOfWork: UnitOfWork;
  transactions(): number;
}

function counting(repos: FakeRepositories): CountingUnitOfWork {
  let count = 0;
  return {
    unitOfWork: {
      async runInTransaction<T>(work: (client: RepositoryClient) => Promise<T>): Promise<T> {
        count += 1;
        return repos.unitOfWork.runInTransaction(work);
      },
    },
    transactions: () => count,
  };
}

let repos: FakeRepositories;
let counter: CountingUnitOfWork;
let reset: ReturnType<typeof createTournamentResetService>;

beforeEach(() => {
  repos = createFakeRepositories();
  counter = counting(repos);
  reset = createTournamentResetService(counter.unitOfWork, createRealtimeEventService());
});

interface Scenario {
  readonly tournamentId: string;
  readonly categoryId: string;
  readonly stageId: string;
  readonly courtId: string;
  readonly matchId: string;
  readonly entryIds: readonly string[];
}

/**
 * A live tournament whose single match is scheduled and completed: the match
 * has two participants, a stored game and a winner, and its stage is ACTIVE.
 */
async function seedPlayedTournament(
  status: 'REGISTRATION_OPEN' = 'REGISTRATION_OPEN',
): Promise<Scenario> {
  const tournamentId = await seedTournament(repos.client, { status });
  const categoryId = await seedCategory(repos.client, { tournamentId });
  const stageId = await seedStage(repos.client, categoryId, { status: 'ACTIVE' });
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
  await repos.client.matches.schedule(matchId, {
    courtId,
    scheduledStartAt: new Date('2026-10-05T10:00:00.000Z'),
    scheduledEndAt: new Date('2026-10-05T10:30:00.000Z'),
  });
  await repos.client.matchGames.createMany([
    { matchId, gameNumber: 1, participant1Points: 21, participant2Points: 15, winnerSlot: 1 },
  ]);
  await repos.client.matches.complete(matchId, entryA.id);
  return { tournamentId, categoryId, stageId, courtId, matchId, entryIds: [entryA.id, entryB.id] };
}

describe('TournamentResetService.reset', () => {
  it('clears every match result and schedule and reopens the stage', async () => {
    const scenario = await seedPlayedTournament();

    const summary = await reset.reset(scenario.tournamentId);

    expect(summary).toEqual({
      tournamentId: scenario.tournamentId,
      matchesReset: 1,
      stagesReopened: 1,
    });

    const match = await repos.client.matches.findById(scenario.matchId);
    expect(match).toMatchObject({
      status: 'SCHEDULED',
      winnerEntryId: null,
      courtId: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
    });
    expect(await repos.client.matchGames.listByMatch(scenario.matchId)).toEqual([]);

    const stage = await repos.client.stages.findById(scenario.stageId);
    expect(stage?.status).toBe('PENDING');
  });

  it('reopens a COMPLETED stage to PENDING', async () => {
    const scenario = await seedPlayedTournament();
    await repos.client.stages.updateStatus(scenario.stageId, 'COMPLETED');

    await reset.reset(scenario.tournamentId);

    const stage = await repos.client.stages.findById(scenario.stageId);
    expect(stage?.status).toBe('PENDING');
  });

  it('leaves entries, categories, courts and the tournament status untouched', async () => {
    const scenario = await seedPlayedTournament();

    await reset.reset(scenario.tournamentId);

    expect(await repos.client.entries.listByCategory(scenario.categoryId)).toHaveLength(2);
    expect(await repos.client.categories.findById(scenario.categoryId)).toBeDefined();
    expect(await repos.client.courts.findById(scenario.courtId)).toBeDefined();
    const tournament = await repos.client.tournaments.findById(scenario.tournamentId);
    expect(tournament?.status).toBe('REGISTRATION_OPEN');
  });

  it('records MATCH_UNSCHEDULED for a cleared schedule and STAGE_STATUS_CHANGED for the reopened stage', async () => {
    const scenario = await seedPlayedTournament();

    await reset.reset(scenario.tournamentId);

    const events = await repos.client.realtimeEvents.getPendingEvents(100);
    const types = events.map((event) => event.eventType).sort();
    expect(types).toEqual(['MATCH_UNSCHEDULED', 'STAGE_STATUS_CHANGED']);
    const unscheduled = events.find((event) => event.eventType === 'MATCH_UNSCHEDULED');
    expect(unscheduled?.tournamentId).toBe(scenario.tournamentId);
    expect(unscheduled?.aggregateId).toBe(scenario.matchId);
  });

  it('refuses a COMPLETED tournament with ConflictError and changes nothing', async () => {
    const scenario = await seedPlayedTournament();
    await repos.client.tournaments.updateStatus(scenario.tournamentId, 'COMPLETED');

    await expect(reset.reset(scenario.tournamentId)).rejects.toBeInstanceOf(ConflictError);

    const match = await repos.client.matches.findById(scenario.matchId);
    expect(match?.status).toBe('COMPLETED');
  });

  it('refuses a CANCELLED tournament with ConflictError', async () => {
    const scenario = await seedPlayedTournament();
    await repos.client.tournaments.updateStatus(scenario.tournamentId, 'CANCELLED');

    await expect(reset.reset(scenario.tournamentId)).rejects.toBeInstanceOf(ConflictError);
  });

  it('raises NotFoundError for an unknown id', async () => {
    await expect(reset.reset('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('runs inside exactly one transaction', async () => {
    const scenario = await seedPlayedTournament();
    const before = counter.transactions();

    await reset.reset(scenario.tournamentId);

    expect(counter.transactions() - before).toBe(1);
  });

  it('is idempotent: a second reset changes nothing and records no event', async () => {
    const scenario = await seedPlayedTournament();
    await reset.reset(scenario.tournamentId);
    const eventsAfterFirst = await repos.client.realtimeEvents.getPendingEvents(100);

    const second = await reset.reset(scenario.tournamentId);

    expect(second).toEqual({
      tournamentId: scenario.tournamentId,
      matchesReset: 0,
      stagesReopened: 0,
    });
    const match = await repos.client.matches.findById(scenario.matchId);
    expect(match?.status).toBe('SCHEDULED');
    const stage = await repos.client.stages.findById(scenario.stageId);
    expect(stage?.status).toBe('PENDING');
    expect(await repos.client.realtimeEvents.getPendingEvents(100)).toEqual(eventsAfterFirst);
  });
});
