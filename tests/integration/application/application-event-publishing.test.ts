import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createCourtService,
  createMatchResultService,
  createMatchSchedulingService,
  createMatchService,
  createPlayerService,
  createRealtimeEventService,
  createTournamentCategoryService,
  createTournamentEntryService,
  createTournamentService,
  createTournamentStageService,
  type RealtimeEventService,
  type RepositoryClient,
  type UnitOfWork,
} from '@badminton/application';
import type { KnockoutProgressionService } from '@badminton/application';
import { createPrismaUnitOfWork, createRepositoryClient } from '@badminton/infrastructure';

import { openTestDatabase, resetTournamentData } from '../database/harness.ts';

/**
 * Phase 8.3 application event publishing against **real PostgreSQL**.
 *
 * These drive the actual services through the Prisma unit of work, so the
 * atomicity guarantee is proven with a real interactive transaction rather than
 * a mocked one:
 *
 *   - a committed business change and its `realtime_events` row are visible
 *     together (match scheduling, court creation, result recording);
 *   - when event recording fails the whole transaction rolls back, so the
 *     business row is unchanged and no event is committed;
 *   - when a later business step fails the already-written event rolls back too.
 *
 * Skipped when no database is reachable; required under CI. Uses a dedicated
 * `<database>_publish_test` database so it can run alongside the other suites.
 */

const database = await openTestDatabase('_publish_test');

afterAll(async () => {
  await database?.disconnect();
});

describe.skipIf(!database)('application event publishing against PostgreSQL', () => {
  if (!database) {
    throw new Error('PostgreSQL is required for the event publishing integration tests.');
  }

  const prisma = database.prisma;
  const client = createRepositoryClient(prisma);
  const unitOfWork = createPrismaUnitOfWork(prisma);
  const events = createRealtimeEventService();

  const tournaments = createTournamentService(client, unitOfWork, events);
  const categories = createTournamentCategoryService(client, unitOfWork, events);
  const players = createPlayerService(client);
  const entries = createTournamentEntryService(client, unitOfWork, events);
  const stages = createTournamentStageService(client, unitOfWork, events);
  const matches = createMatchService(client, unitOfWork, events);
  const courts = createCourtService(client, unitOfWork, events);
  const scheduling = createMatchSchedulingService(client, unitOfWork, events);
  const results = createMatchResultService(client, unitOfWork, events);

  beforeEach(async () => {
    await resetTournamentData(prisma);
  });

  async function openTournament(): Promise<string> {
    const tournament = await tournaments.create({
      name: 'Publish Open',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-03T00:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    await tournaments.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });
    return tournament.id;
  }

  async function openCategory(tournamentId: string): Promise<string> {
    const category = await categories.create(tournamentId, {
      name: "Men's Singles",
      code: 'MS',
      format: 'SINGLES',
    });
    await categories.transitionStatus(category.id, { status: 'OPEN' });
    return category.id;
  }

  async function stageAndMatch(categoryId: string): Promise<{ stageId: string; matchId: string }> {
    const stage = await stages.create(categoryId, {
      name: 'Group Stage',
      type: 'GROUP',
      sequence: 1,
    });
    await stages.transitionStatus(stage.id, { status: 'ACTIVE' });
    const match = await matches.create(stage.id, { sequence: 1 });
    return { stageId: stage.id, matchId: match.id };
  }

  async function participantEntry(categoryId: string, name: string): Promise<string> {
    const player = await players.create({ name });
    const entry = await entries.register({ categoryId, playerId: player.id });
    await entries.confirm(entry.id);
    return entry.id;
  }

  async function startedMatch(
    categoryId: string,
    matchId: string,
  ): Promise<{ slot1: string; slot2: string }> {
    const slot1 = await participantEntry(categoryId, 'Player A');
    const slot2 = await participantEntry(categoryId, 'Player B');
    await matches.addParticipant(matchId, { entryId: slot1, slot: 1 });
    await matches.addParticipant(matchId, { entryId: slot2, slot: 2 });
    await matches.transitionStatus(matchId, { status: 'IN_PROGRESS' });
    return { slot1, slot2 };
  }

  async function eventsFor(
    tournamentId: string,
    eventType: string,
  ): Promise<readonly { aggregateId: string; aggregateType: string }[]> {
    return prisma.realtimeEvent.findMany({
      where: { tournamentId, eventType },
      select: { aggregateId: true, aggregateType: true },
    });
  }

  const start = new Date('2026-10-05T10:00:00.000Z');
  const end = new Date('2026-10-05T10:30:00.000Z');
  const oneGame = [{ gameNumber: 1, participant1Points: 21, participant2Points: 15 }];

  it('commits a match schedule and its MATCH_SCHEDULED event together', async () => {
    const tournamentId = await openTournament();
    const categoryId = await openCategory(tournamentId);
    const { matchId } = await stageAndMatch(categoryId);
    const court = await courts.create(tournamentId, { number: 1, name: 'Court 1' });

    await scheduling.schedule(matchId, {
      courtId: court.id,
      scheduledStartAt: start,
      scheduledEndAt: end,
    });

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    expect(match?.courtId).toBe(court.id);
    expect(match?.scheduledStartAt?.getTime()).toBe(start.getTime());

    const published = await eventsFor(tournamentId, 'MATCH_SCHEDULED');
    expect(published).toEqual([{ aggregateId: matchId, aggregateType: 'MATCH' }]);
  });

  it('commits a court and its COURT_CREATED event together', async () => {
    const tournamentId = await openTournament();
    const court = await courts.create(tournamentId, { number: 2, name: 'Court Two' });

    const stored = await prisma.court.findUnique({ where: { id: court.id } });
    expect(stored?.number).toBe(2);

    const published = await eventsFor(tournamentId, 'COURT_CREATED');
    expect(published).toEqual([{ aggregateId: court.id, aggregateType: 'COURT' }]);
  });

  it('commits a result, its games and its MATCH_RESULT_RECORDED + MATCH_COMPLETED events together', async () => {
    const tournamentId = await openTournament();
    const categoryId = await openCategory(tournamentId);
    const { matchId } = await stageAndMatch(categoryId);
    const { slot1 } = await startedMatch(categoryId, matchId);

    await results.recordResult(matchId, { games: oneGame });

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    expect(match?.status).toBe('COMPLETED');
    expect(match?.winnerEntryId).toBe(slot1);
    expect(await prisma.matchGame.count({ where: { matchId } })).toBe(1);

    const resultEvents = await eventsFor(tournamentId, 'MATCH_RESULT_RECORDED');
    expect(resultEvents).toEqual([{ aggregateId: matchId, aggregateType: 'MATCH' }]);
    const completionEvents = await eventsFor(tournamentId, 'MATCH_COMPLETED');
    expect(completionEvents).toEqual([{ aggregateId: matchId, aggregateType: 'MATCH' }]);
  });

  it('rolls the business change back when event recording fails', async () => {
    const tournamentId = await openTournament();
    const categoryId = await openCategory(tournamentId);
    const { matchId } = await stageAndMatch(categoryId);
    const court = await courts.create(tournamentId, { number: 1, name: 'Court 1' });

    const failingEvents: RealtimeEventService = {
      record: () => Promise.reject(new Error('outbox unavailable')),
    };
    const failingScheduling = createMatchSchedulingService(client, unitOfWork, failingEvents);

    await expect(
      failingScheduling.schedule(matchId, {
        courtId: court.id,
        scheduledStartAt: start,
        scheduledEndAt: end,
      }),
    ).rejects.toThrow('outbox unavailable');

    // The business write was rolled back with the failed event.
    const match = await prisma.match.findUnique({ where: { id: matchId } });
    expect(match?.courtId).toBeNull();
    expect(match?.scheduledStartAt).toBeNull();
    expect(await prisma.realtimeEvent.count({ where: { eventType: 'MATCH_SCHEDULED' } })).toBe(0);
  });

  it('rolls the result back when a later business step fails after the event was written', async () => {
    const tournamentId = await openTournament();
    const categoryId = await openCategory(tournamentId);
    const { matchId } = await stageAndMatch(categoryId);
    const { slot1, slot2 } = await startedMatch(categoryId, matchId);

    // The events are recorded before knockout progression runs, so a failing
    // progression proves the already-written events roll back with the result.
    const failingProgression: KnockoutProgressionService = {
      progress: () => Promise.reject(new Error('progression failed')),
    };
    const failingResults = createMatchResultService(client, unitOfWork, events, failingProgression);

    await expect(failingResults.recordResult(matchId, { games: oneGame })).rejects.toThrow(
      'progression failed',
    );

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    expect(match?.status).toBe('IN_PROGRESS');
    expect(match?.winnerEntryId).toBeNull();
    expect(await prisma.matchGame.count({ where: { matchId } })).toBe(0);
    expect(
      await prisma.realtimeEvent.count({ where: { eventType: 'MATCH_RESULT_RECORDED' } }),
    ).toBe(0);
    expect(await prisma.realtimeEvent.count({ where: { eventType: 'MATCH_COMPLETED' } })).toBe(0);
    // The participants remain intact; only the result was rolled back.
    expect(await prisma.matchParticipant.count({ where: { matchId } })).toBe(2);
    expect(slot1).not.toBe(slot2);
  });

  it('rolls the business write back when the event repository rejects inside the transaction', async () => {
    const tournamentId = await openTournament();
    const categoryId = await openCategory(tournamentId);
    const { matchId } = await stageAndMatch(categoryId);
    const court = await courts.create(tournamentId, { number: 1, name: 'Court 1' });

    // A unit of work that wraps the transactional client so the outbox write
    // itself fails, exercising the real PostgreSQL rollback with the real
    // service and the real repository port.
    const breakingUnitOfWork: UnitOfWork = {
      runInTransaction: (work) =>
        unitOfWork.runInTransaction((tx: RepositoryClient) =>
          work({
            ...tx,
            realtimeEvents: {
              ...tx.realtimeEvents,
              create: () => Promise.reject(new Error('realtime_events insert failed')),
            },
          }),
        ),
    };
    const breakingScheduling = createMatchSchedulingService(client, breakingUnitOfWork, events);

    await expect(
      breakingScheduling.schedule(matchId, {
        courtId: court.id,
        scheduledStartAt: start,
        scheduledEndAt: end,
      }),
    ).rejects.toThrow('realtime_events insert failed');

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    expect(match?.courtId).toBeNull();
    // Setup transitions (tournament/category/stage) still have their own events;
    // what must be absent is any event for the rejected schedule.
    expect(await eventsFor(tournamentId, 'MATCH_SCHEDULED')).toHaveLength(0);
  });
});
