import {
  createMatchSchedulingService,
  createTournamentDashboardService,
} from '@badminton/application';
import { NotFoundError } from '@badminton/domain';
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
 * Dashboard aggregation tests.
 *
 * The dashboard is a derived read model: it persists nothing and assembles its
 * timeline slices from batched reads. These tests assert the aggregation rules
 * (live/upcoming/recent/unscheduled classification, ordering and bounded
 * slices) rather than any persistence.
 */

let repos: FakeRepositories;

const NOW = new Date('2026-10-05T10:00:00.000Z');

function dashboard() {
  return createTournamentDashboardService(repos.client, () => NOW);
}

function scheduling() {
  return createMatchSchedulingService(repos.client);
}

beforeEach(() => {
  repos = createFakeRepositories();
});

async function entryIn(categoryId: string, name: string): Promise<string> {
  const playerId = await seedPlayer(repos.client, name);
  const entry = await repos.client.entries.create({
    categoryId,
    playerId,
    teamId: null,
    seed: null,
    status: 'CONFIRMED',
  });
  return entry.id;
}

describe('TournamentDashboardService', () => {
  it('rejects an unknown tournament', async () => {
    await expect(
      dashboard().getDashboard('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('classifies matches into live, upcoming, recent and unscheduled buckets', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const stageId = await seedStage(repos.client, categoryId);
    const courtId = await seedCourt(repos.client, tournamentId);

    const [entryA, entryB] = await Promise.all([
      entryIn(categoryId, 'Player A'),
      entryIn(categoryId, 'Player B'),
    ]);

    const liveId = await seedMatch(repos.client, stageId, 1);
    const upcomingId = await seedMatch(repos.client, stageId, 2);
    const unscheduledId = await seedMatch(repos.client, stageId, 3);
    const completedId = await seedMatch(repos.client, stageId, 4);

    await repos.client.matchParticipants.create({
      matchId: liveId,
      entryId: entryA,
      slot: 1,
    });
    await repos.client.matchParticipants.create({
      matchId: liveId,
      entryId: entryB,
      slot: 2,
    });

    await scheduling().schedule(liveId, {
      courtId,
      scheduledStartAt: new Date('2026-10-05T09:00:00.000Z'),
      scheduledEndAt: new Date('2026-10-05T09:30:00.000Z'),
    });
    await repos.client.matches.updateStatus(liveId, 'IN_PROGRESS');

    await scheduling().schedule(upcomingId, {
      courtId,
      scheduledStartAt: new Date('2026-10-05T11:00:00.000Z'),
      scheduledEndAt: new Date('2026-10-05T11:30:00.000Z'),
    });

    await scheduling().schedule(completedId, {
      courtId,
      scheduledStartAt: new Date('2026-10-05T08:00:00.000Z'),
      scheduledEndAt: new Date('2026-10-05T08:30:00.000Z'),
    });
    await repos.client.matches.complete(completedId, entryA);

    const view = await dashboard().getDashboard(tournamentId);

    expect(view.liveMatches.map((match) => match.matchId)).toEqual([liveId]);
    expect(view.liveMatches[0]?.participants.map((part) => part.name)).toEqual([
      'Player A',
      'Player B',
    ]);
    expect(view.liveMatches[0]?.courtId).toBe(courtId);
    expect(view.upcomingMatches.map((match) => match.matchId)).toEqual([upcomingId]);
    expect(view.recentResults.map((match) => match.matchId)).toEqual([completedId]);
    expect(view.unscheduledMatches.map((match) => match.matchId)).toEqual([unscheduledId]);
    expect(view.summary).toEqual({
      totalEntries: 2,
      totalMatches: 4,
      completedMatches: 1,
      inProgressMatches: 1,
      scheduledMatches: 1,
      unscheduledMatches: 1,
    });
  });

  it('orders upcoming matches by start time then court number', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const stageId = await seedStage(repos.client, categoryId);
    const court1 = await seedCourt(repos.client, tournamentId, { number: 1 });
    const court2 = await seedCourt(repos.client, tournamentId, { number: 2 });

    const later = await seedMatch(repos.client, stageId, 1);
    const earlier = await seedMatch(repos.client, stageId, 2);
    const sameTime = await seedMatch(repos.client, stageId, 3);

    await scheduling().schedule(later, {
      courtId: court1,
      scheduledStartAt: new Date('2026-10-05T12:00:00.000Z'),
      scheduledEndAt: new Date('2026-10-05T12:30:00.000Z'),
    });
    await scheduling().schedule(earlier, {
      courtId: court2,
      scheduledStartAt: new Date('2026-10-05T11:00:00.000Z'),
      scheduledEndAt: new Date('2026-10-05T11:30:00.000Z'),
    });
    await scheduling().schedule(sameTime, {
      courtId: court1,
      scheduledStartAt: new Date('2026-10-05T11:00:00.000Z'),
      scheduledEndAt: new Date('2026-10-05T11:30:00.000Z'),
    });

    const view = await dashboard().getDashboard(tournamentId);
    expect(view.upcomingMatches.map((match) => match.matchId)).toEqual([sameTime, earlier, later]);
  });

  it('marks a court busy only while it hosts a live match', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const stageId = await seedStage(repos.client, categoryId);
    const courtId = await seedCourt(repos.client, tournamentId);
    const matchId = await seedMatch(repos.client, stageId, 1);

    await scheduling().schedule(matchId, {
      courtId,
      scheduledStartAt: new Date('2026-10-05T09:00:00.000Z'),
      scheduledEndAt: new Date('2026-10-05T09:30:00.000Z'),
    });

    let view = await dashboard().getDashboard(tournamentId);
    expect(view.courts[0]?.busy).toBe(false);

    await repos.client.matches.updateStatus(matchId, 'IN_PROGRESS');
    view = await dashboard().getDashboard(tournamentId);
    expect(view.courts[0]?.busy).toBe(true);
  });

  it('reports per-category and per-stage progress', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const groupStage = await seedStage(repos.client, categoryId, { sequence: 1 });
    const knockoutStage = await repos.client.stages.create({
      categoryId,
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 2,
      drawSize: 4,
      status: 'ACTIVE',
    });

    const group1 = await seedMatch(repos.client, groupStage, 1);
    await seedMatch(repos.client, groupStage, 2);
    const knockout1 = await seedMatch(repos.client, knockoutStage.id, 1);

    const entryId = await entryIn(categoryId, 'Winner');
    await repos.client.matches.complete(group1, entryId);
    await repos.client.matches.complete(knockout1, entryId);

    const view = await dashboard().getDashboard(tournamentId);

    expect(view.categories).toHaveLength(1);
    const category = view.categories[0];
    expect(category?.totalMatches).toBe(3);
    expect(category?.completedMatches).toBe(2);
    expect(category?.stages.map((stage) => stage.type)).toEqual(['GROUP', 'KNOCKOUT']);
    expect(category?.stages[0]).toMatchObject({ totalMatches: 2, completedMatches: 1 });
    expect(category?.stages[1]).toMatchObject({ totalMatches: 1, completedMatches: 1 });
  });
});
