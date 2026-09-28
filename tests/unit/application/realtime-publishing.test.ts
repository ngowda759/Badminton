import {
  createCourtService,
  createKnockoutBracketService,
  createKnockoutProgressionService,
  createMatchResultService,
  createMatchSchedulingService,
  createMatchService,
  createRealtimeEventService,
  createTournamentCategoryService,
  createTournamentEntryService,
  createTournamentService,
  createTournamentStageService,
  type RealtimeEventService,
  type RepositoryClient,
} from '@badminton/application';
import type { RealtimeEvent } from '@badminton/domain';
import { ConflictError } from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import {
  seedCategory,
  seedCourt,
  seedKnockoutStage,
  seedMatch,
  seedPlayer,
  seedStage,
  seedTournament,
} from './fixtures.ts';

/**
 * Phase 8.3 application event publishing tests.
 *
 * Each integrated service runs against the real service code, the in-memory
 * repository ports and the real `RealtimeEventService`. They assert the Phase
 * 8.3 contract: every successful live-tournament mutation records exactly one
 * well-formed outbox event (correct type, tournament, aggregate and id), a
 * no-op/idempotent mutation records nothing, and a rollback - whether the
 * business write or the event write fails - leaves no committed event behind.
 *
 * The real PostgreSQL atomicity is proven separately in
 * `tests/integration/application/`; these tests pin the service-level behaviour.
 */

let repos: FakeRepositories;
const events = createRealtimeEventService();

beforeEach(() => {
  repos = createFakeRepositories();
});

function scheduling() {
  return createMatchSchedulingService(repos.client, repos.unitOfWork, events);
}
function courts() {
  return createCourtService(repos.client, repos.unitOfWork, events);
}
function matches() {
  return createMatchService(repos.client, repos.unitOfWork, events);
}
function results(progression = createKnockoutProgressionService()) {
  return createMatchResultService(repos.client, repos.unitOfWork, events, progression);
}
function tournaments() {
  return createTournamentService(repos.client, repos.unitOfWork, events);
}
function categories() {
  return createTournamentCategoryService(repos.client, repos.unitOfWork, events);
}
function stages() {
  return createTournamentStageService(repos.client, repos.unitOfWork, events);
}
function entries() {
  return createTournamentEntryService(repos.client, repos.unitOfWork, events);
}
function knockout() {
  return createKnockoutBracketService(repos.client, repos.unitOfWork);
}

/** The pending outbox rows, oldest first. */
async function pending(): Promise<readonly RealtimeEvent[]> {
  return repos.client.realtimeEvents.getPendingEvents(100);
}

/** The single pending event, asserting there is exactly one. */
async function onlyEvent(): Promise<RealtimeEvent> {
  const all = await pending();
  expect(all).toHaveLength(1);
  const [event] = all;
  if (!event) {
    throw new Error('Expected one pending event.');
  }
  return event;
}

const start = new Date('2026-10-05T10:00:00.000Z');
const end = new Date('2026-10-05T10:30:00.000Z');

async function matchInTournament(): Promise<{
  tournamentId: string;
  categoryId: string;
  matchId: string;
}> {
  const tournamentId = await seedTournament(repos.client);
  const categoryId = await seedCategory(repos.client, { tournamentId });
  const stageId = await seedStage(repos.client, categoryId);
  const matchId = await seedMatch(repos.client, stageId);
  return { tournamentId, categoryId, matchId };
}

/** A service whose `record` always fails, to force the event-write failure path. */
function failingEventService(): RealtimeEventService {
  return {
    record: () => Promise.reject(new Error('outbox unavailable')),
  };
}

/**
 * Replaces a repository method with one that throws, so the *business* write can
 * be forced to fail after the event path was reached. The fake unit of work
 * restores the in-memory state on rejection, exactly as PostgreSQL would.
 */
function breakRepository(repository: keyof RepositoryClient, method: string): void {
  const target = repos.client[repository] as unknown as Record<string, unknown>;
  target[method] = () => {
    throw new Error(`${repository}.${method} failed`);
  };
}

describe('MatchSchedulingService publishes scheduling events', () => {
  it('records MATCH_SCHEDULED with the owning tournament and match aggregate', async () => {
    const { tournamentId, matchId } = await matchInTournament();
    const courtId = await seedCourt(repos.client, tournamentId);

    await scheduling().schedule(matchId, { courtId, scheduledStartAt: start, scheduledEndAt: end });

    const event = await onlyEvent();
    expect(event).toMatchObject({
      tournamentId,
      eventType: 'MATCH_SCHEDULED',
      aggregateType: 'MATCH',
      aggregateId: matchId,
      payload: null,
      publishedAt: null,
    });
  });

  it('records MATCH_UNSCHEDULED when a schedule is cleared', async () => {
    const { tournamentId, matchId } = await matchInTournament();
    const courtId = await seedCourt(repos.client, tournamentId);
    await scheduling().schedule(matchId, { courtId, scheduledStartAt: start, scheduledEndAt: end });

    await scheduling().unschedule(matchId);

    const all = await pending();
    expect(all.map((event) => event.eventType)).toEqual(['MATCH_SCHEDULED', 'MATCH_UNSCHEDULED']);
    expect(all[1]).toMatchObject({
      tournamentId,
      aggregateType: 'MATCH',
      aggregateId: matchId,
    });
  });

  it('records no event when the schedule is rejected', async () => {
    const { tournamentId, matchId } = await matchInTournament();
    const inactive = await seedCourt(repos.client, tournamentId, { status: 'INACTIVE' });

    await expect(
      scheduling().schedule(matchId, {
        courtId: inactive,
        scheduledStartAt: start,
        scheduledEndAt: end,
      }),
    ).rejects.toBeDefined();

    expect(await pending()).toHaveLength(0);
  });

  it('rolls the schedule back when the event cannot be recorded', async () => {
    const { tournamentId, matchId } = await matchInTournament();
    const courtId = await seedCourt(repos.client, tournamentId);
    const failing = createMatchSchedulingService(
      repos.client,
      repos.unitOfWork,
      failingEventService(),
    );

    await expect(
      failing.schedule(matchId, { courtId, scheduledStartAt: start, scheduledEndAt: end }),
    ).rejects.toThrow('outbox unavailable');

    const match = await repos.client.matches.findById(matchId);
    expect(match?.courtId).toBeNull();
    expect(await pending()).toHaveLength(0);
  });

  it('commits no event when the business write fails', async () => {
    const { tournamentId, matchId } = await matchInTournament();
    const courtId = await seedCourt(repos.client, tournamentId);
    breakRepository('matches', 'schedule');

    await expect(
      scheduling().schedule(matchId, { courtId, scheduledStartAt: start, scheduledEndAt: end }),
    ).rejects.toThrow('matches.schedule failed');

    expect(await pending()).toHaveLength(0);
  });
});

describe('CourtService publishes court events', () => {
  it('records COURT_CREATED with the court aggregate', async () => {
    const tournamentId = await seedTournament(repos.client);
    const court = await courts().create(tournamentId, { number: 1, name: 'Show Court' });

    const event = await onlyEvent();
    expect(event).toMatchObject({
      tournamentId,
      eventType: 'COURT_CREATED',
      aggregateType: 'COURT',
      aggregateId: court.id,
    });
  });

  it('records COURT_UPDATED on an edit', async () => {
    const tournamentId = await seedTournament(repos.client);
    const courtId = await seedCourt(repos.client, tournamentId);

    await courts().update(courtId, { name: 'Centre Court' });

    expect(await onlyEvent()).toMatchObject({
      tournamentId,
      eventType: 'COURT_UPDATED',
      aggregateType: 'COURT',
      aggregateId: courtId,
    });
  });

  it('records COURT_STATUS_CHANGED on a real transition', async () => {
    const tournamentId = await seedTournament(repos.client);
    const courtId = await seedCourt(repos.client, tournamentId);

    await courts().transitionStatus(courtId, { status: 'INACTIVE' });

    expect(await onlyEvent()).toMatchObject({
      tournamentId,
      eventType: 'COURT_STATUS_CHANGED',
      aggregateType: 'COURT',
      aggregateId: courtId,
    });
  });

  it('records no event for a no-op status transition', async () => {
    const tournamentId = await seedTournament(repos.client);
    const courtId = await seedCourt(repos.client, tournamentId, { status: 'ACTIVE' });

    await courts().transitionStatus(courtId, { status: 'ACTIVE' });

    expect(await pending()).toHaveLength(0);
  });

  it('records no event when a duplicate court number is rejected', async () => {
    const tournamentId = await seedTournament(repos.client);
    await seedCourt(repos.client, tournamentId, { number: 1 });

    await expect(
      courts().create(tournamentId, { number: 1, name: 'Duplicate' }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await pending()).toHaveLength(0);
  });

  it('rolls the court back when the event cannot be recorded', async () => {
    const tournamentId = await seedTournament(repos.client);
    const failing = createCourtService(repos.client, repos.unitOfWork, failingEventService());

    await expect(failing.create(tournamentId, { number: 1, name: 'Show Court' })).rejects.toThrow(
      'outbox unavailable',
    );

    expect(await repos.client.courts.listByTournament(tournamentId)).toHaveLength(0);
    expect(await pending()).toHaveLength(0);
  });
});

describe('MatchService publishes match lifecycle events', () => {
  async function startedMatchSetup(): Promise<{ tournamentId: string; matchId: string }> {
    const { tournamentId, categoryId, matchId } = await matchInTournament();
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
    await repos.client.matchParticipants.create({ matchId, entryId: entryA.id, slot: 1 });
    await repos.client.matchParticipants.create({ matchId, entryId: entryB.id, slot: 2 });
    return { tournamentId, matchId };
  }

  it('records MATCH_STARTED on the SCHEDULED -> IN_PROGRESS transition', async () => {
    const { tournamentId, matchId } = await startedMatchSetup();

    await matches().transitionStatus(matchId, { status: 'IN_PROGRESS' });

    expect(await onlyEvent()).toMatchObject({
      tournamentId,
      eventType: 'MATCH_STARTED',
      aggregateType: 'MATCH',
      aggregateId: matchId,
    });
  });

  it('records MATCH_CANCELLED on the SCHEDULED -> CANCELLED transition', async () => {
    const { tournamentId, matchId } = await startedMatchSetup();

    await matches().transitionStatus(matchId, { status: 'CANCELLED' });

    expect(await onlyEvent()).toMatchObject({
      tournamentId,
      eventType: 'MATCH_CANCELLED',
      aggregateType: 'MATCH',
      aggregateId: matchId,
    });
  });

  it('records no event when the transition is rejected', async () => {
    const { matchId } = await startedMatchSetup();
    await matches().transitionStatus(matchId, { status: 'IN_PROGRESS' });

    await expect(
      matches().transitionStatus(matchId, { status: 'SCHEDULED' }),
    ).rejects.toBeDefined();

    // Only the first (valid) start event is present.
    expect((await pending()).map((event) => event.eventType)).toEqual(['MATCH_STARTED']);
  });

  it('rolls the status change back when the event cannot be recorded', async () => {
    const { matchId } = await startedMatchSetup();
    const failing = createMatchService(repos.client, repos.unitOfWork, failingEventService());

    await expect(failing.transitionStatus(matchId, { status: 'IN_PROGRESS' })).rejects.toThrow(
      'outbox unavailable',
    );

    const match = await repos.client.matches.findById(matchId);
    expect(match?.status).toBe('SCHEDULED');
    expect(await pending()).toHaveLength(0);
  });
});

describe('MatchResultService publishes result and completion events', () => {
  const twoZero = [
    { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
    { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
  ];

  async function startedMatch(): Promise<{ tournamentId: string; matchId: string }> {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const stageId = await seedStage(repos.client, categoryId);
    const matchId = await seedMatch(repos.client, stageId);
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
    await repos.client.matchParticipants.create({ matchId, entryId: entryA.id, slot: 1 });
    await repos.client.matchParticipants.create({ matchId, entryId: entryB.id, slot: 2 });
    await matches().transitionStatus(matchId, { status: 'IN_PROGRESS' });
    return { tournamentId, matchId };
  }

  it('records MATCH_RESULT_RECORDED and MATCH_COMPLETED together', async () => {
    const { tournamentId, matchId } = await startedMatch();

    await results().recordResult(matchId, { games: twoZero });

    // Discard the MATCH_STARTED event from the setup so the assertion is exact.
    const all = await pending();
    const resultEvents = all.filter((event) => event.eventType !== 'MATCH_STARTED');
    expect(resultEvents.map((event) => event.eventType)).toEqual([
      'MATCH_RESULT_RECORDED',
      'MATCH_COMPLETED',
    ]);
    for (const event of resultEvents) {
      expect(event).toMatchObject({
        tournamentId,
        aggregateType: 'MATCH',
        aggregateId: matchId,
        payload: null,
      });
    }
  });

  it('records no event when the result is rejected', async () => {
    const { matchId } = await startedMatch();
    // A zero-game submission is invalid and is rejected before the transaction.
    await expect(results().recordResult(matchId, { games: [] })).rejects.toBeDefined();
    expect((await pending()).map((event) => event.eventType)).toEqual(['MATCH_STARTED']);
  });

  it('rolls the result back when the event cannot be recorded', async () => {
    const { matchId } = await startedMatch();
    const failing = createMatchResultService(
      repos.client,
      repos.unitOfWork,
      failingEventService(),
      createKnockoutProgressionService(),
    );

    await expect(failing.recordResult(matchId, { games: twoZero })).rejects.toThrow(
      'outbox unavailable',
    );

    const match = await repos.client.matches.findById(matchId);
    expect(match?.status).toBe('IN_PROGRESS');
    expect(match?.winnerEntryId).toBeNull();
    expect(await repos.client.matchGames.listByMatch(matchId)).toHaveLength(0);
    expect((await pending()).map((event) => event.eventType)).toEqual(['MATCH_STARTED']);
  });
});

describe('Knockout progression publishes KNOCKOUT_MATCH_POPULATED', () => {
  const twoZero = [
    { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
    { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
  ];

  async function bracketOfFour(): Promise<{ tournamentId: string; stageId: string }> {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const entryIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const playerId = await seedPlayer(repos.client, `Player ${String(index + 1)}`);
      const entry = await repos.client.entries.create({
        categoryId,
        playerId,
        teamId: null,
        seed: null,
        status: 'CONFIRMED',
      });
      entryIds.push(entry.id);
    }
    await knockout().generateBracket(stageId, { entryIds });
    return { tournamentId, stageId };
  }

  it('records KNOCKOUT_MATCH_POPULATED when progression fills the next round', async () => {
    const { tournamentId, stageId } = await bracketOfFour();
    const bracket = await knockout().getBracket(stageId);
    const semi = bracket.rounds[0]?.matches[0];
    if (!semi) {
      throw new Error('Expected a semifinal.');
    }

    await matches().transitionStatus(semi.matchId, { status: 'IN_PROGRESS' });
    await results().recordResult(semi.matchId, { games: twoZero });

    const eventTypes = (await pending()).map((event) => event.eventType);
    expect(eventTypes).toContain('KNOCKOUT_MATCH_POPULATED');

    const populated = (await pending()).find(
      (event) => event.eventType === 'KNOCKOUT_MATCH_POPULATED',
    );
    expect(populated).toMatchObject({
      tournamentId,
      aggregateType: 'MATCH',
      aggregateId: semi.matchId,
    });
  });

  it('does not duplicate the populated event when progression is a no-op', async () => {
    const { stageId } = await bracketOfFour();
    const bracket = await knockout().getBracket(stageId);
    const semi = bracket.rounds[0]?.matches[0];
    if (!semi) {
      throw new Error('Expected a semifinal.');
    }
    await matches().transitionStatus(semi.matchId, { status: 'IN_PROGRESS' });
    const result = await results().recordResult(semi.matchId, { games: twoZero });

    // Replaying progression is a no-op and returns false, so the caller records
    // nothing: the populated event count stays at exactly one.
    const progression = createKnockoutProgressionService();
    const populatedAgain = await progression.progress(
      repos.client,
      semi.matchId,
      result.winnerEntryId,
    );
    expect(populatedAgain).toBe(false);

    const populatedCount = (await pending()).filter(
      (event) => event.eventType === 'KNOCKOUT_MATCH_POPULATED',
    ).length;
    expect(populatedCount).toBe(1);
  });

  it('records no populated event when the match is the final', async () => {
    const { stageId } = await bracketOfFour();
    const bracket = await knockout().getBracket(stageId);
    const final = bracket.rounds.at(-1)?.matches[0];
    if (!final) {
      throw new Error('Expected a final.');
    }
    // Fill the final from both semifinals so it can be started.
    for (const semi of bracket.rounds[0]?.matches ?? []) {
      await matches().transitionStatus(semi.matchId, { status: 'IN_PROGRESS' });
      await results().recordResult(semi.matchId, { games: twoZero });
    }

    await matches().transitionStatus(final.matchId, { status: 'IN_PROGRESS' });
    await results().recordResult(final.matchId, { games: twoZero });

    const finalEvents = (await pending()).filter((event) => event.aggregateId === final.matchId);
    expect(finalEvents.map((event) => event.eventType)).toEqual([
      'MATCH_STARTED',
      'MATCH_RESULT_RECORDED',
      'MATCH_COMPLETED',
    ]);
  });
});

describe('lifecycle transitions publish tournament, category, stage and entry events', () => {
  it('records TOURNAMENT_STATUS_CHANGED on a tournament transition', async () => {
    const tournamentId = await seedTournament(repos.client, { status: 'DRAFT' });

    await tournaments().transitionStatus(tournamentId, { status: 'REGISTRATION_OPEN' });

    expect(await onlyEvent()).toMatchObject({
      tournamentId,
      eventType: 'TOURNAMENT_STATUS_CHANGED',
      aggregateType: 'TOURNAMENT',
      aggregateId: tournamentId,
    });
  });

  it('records no tournament event when the transition is rejected', async () => {
    const tournamentId = await seedTournament(repos.client, { status: 'DRAFT' });

    await expect(
      tournaments().transitionStatus(tournamentId, { status: 'COMPLETED' }),
    ).rejects.toBeDefined();

    expect(await pending()).toHaveLength(0);
  });

  it('records CATEGORY_STATUS_CHANGED on a category transition', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId, status: 'DRAFT' });

    await categories().transitionStatus(categoryId, { status: 'OPEN' });

    expect(await onlyEvent()).toMatchObject({
      tournamentId,
      eventType: 'CATEGORY_STATUS_CHANGED',
      aggregateType: 'CATEGORY',
      aggregateId: categoryId,
    });
  });

  it('records STAGE_STATUS_CHANGED on a stage transition', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const stageId = await seedStage(repos.client, categoryId, { status: 'PENDING' });

    await stages().transitionStatus(stageId, { status: 'ACTIVE' });

    expect(await onlyEvent()).toMatchObject({
      tournamentId,
      eventType: 'STAGE_STATUS_CHANGED',
      aggregateType: 'STAGE',
      aggregateId: stageId,
    });
  });

  it('records ENTRY_STATUS_CHANGED on an entry confirm/withdraw/disqualify', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const playerId = await seedPlayer(repos.client);
    const entry = await repos.client.entries.create({
      categoryId,
      playerId,
      teamId: null,
      seed: null,
      status: 'PENDING',
    });

    await entries().confirm(entry.id);

    expect(await onlyEvent()).toMatchObject({
      tournamentId,
      eventType: 'ENTRY_STATUS_CHANGED',
      aggregateType: 'ENTRY',
      aggregateId: entry.id,
    });
  });

  it('rolls an entry transition back when the event cannot be recorded', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const playerId = await seedPlayer(repos.client);
    const entry = await repos.client.entries.create({
      categoryId,
      playerId,
      teamId: null,
      seed: null,
      status: 'PENDING',
    });
    const failing = createTournamentEntryService(
      repos.client,
      repos.unitOfWork,
      failingEventService(),
    );

    await expect(failing.confirm(entry.id)).rejects.toThrow('outbox unavailable');

    const reloaded = await repos.client.entries.findById(entry.id);
    expect(reloaded?.status).toBe('PENDING');
    expect(await pending()).toHaveLength(0);
  });
});
