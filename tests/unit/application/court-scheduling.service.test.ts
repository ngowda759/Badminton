import {
  createCourtService,
  createMatchSchedulingService,
  createRealtimeEventService,
} from '@badminton/application';
import {
  BusinessRuleViolationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import { seedCategory, seedCourt, seedMatch, seedStage, seedTournament } from './fixtures.ts';

/**
 * Court management and match scheduling service tests.
 *
 * These exercise the real services over the in-memory repositories: court
 * uniqueness and lifecycle, the tournament-ownership and court-status rules,
 * the match lifecycle restrictions and the overlap detection that the database
 * exclusion constraint enforces for real.
 */

let repos: FakeRepositories;
let courts: ReturnType<typeof createCourtService>;
let scheduling: ReturnType<typeof createMatchSchedulingService>;

beforeEach(() => {
  repos = createFakeRepositories();
  courts = createCourtService(repos.client, repos.unitOfWork, createRealtimeEventService());
  scheduling = createMatchSchedulingService(
    repos.client,
    repos.unitOfWork,
    createRealtimeEventService(),
  );
});

const start = new Date('2026-10-05T10:00:00.000Z');
const end = new Date('2026-10-05T10:30:00.000Z');

async function matchInTournament(): Promise<{ tournamentId: string; matchId: string }> {
  const tournamentId = await seedTournament(repos.client);
  const categoryId = await seedCategory(repos.client, { tournamentId });
  const stageId = await seedStage(repos.client, categoryId);
  const matchId = await seedMatch(repos.client, stageId);
  return { tournamentId, matchId };
}

describe('CourtService.create', () => {
  it('creates a court scoped to the tournament', async () => {
    const tournamentId = await seedTournament(repos.client);
    const court = await courts.create(tournamentId, { number: 1, name: 'Show Court' });
    expect(court).toMatchObject({
      tournamentId,
      number: 1,
      name: 'Show Court',
      status: 'ACTIVE',
    });
  });

  it('rejects a duplicate court number within the same tournament', async () => {
    const tournamentId = await seedTournament(repos.client);
    await courts.create(tournamentId, { number: 1, name: 'Court 1' });
    await expect(
      courts.create(tournamentId, { number: 1, name: 'Court 1 again' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows the same court number in a different tournament', async () => {
    const first = await seedTournament(repos.client);
    const second = await seedTournament(repos.client);
    await courts.create(first, { number: 1, name: 'Court 1' });
    await expect(courts.create(second, { number: 1, name: 'Court 1' })).resolves.toMatchObject({
      tournamentId: second,
      number: 1,
    });
  });

  it('rejects a blank court name', async () => {
    const tournamentId = await seedTournament(repos.client);
    await expect(courts.create(tournamentId, { number: 1, name: '   ' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects an unknown tournament', async () => {
    await expect(
      courts.create('00000000-0000-0000-0000-000000000000', { number: 1, name: 'Court' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('CourtService.update and transitionStatus', () => {
  it('renames a court', async () => {
    const tournamentId = await seedTournament(repos.client);
    const courtId = await seedCourt(repos.client, tournamentId);
    const updated = await courts.update(courtId, { name: 'Centre Court' });
    expect(updated.name).toBe('Centre Court');
  });

  it('rejects a number that clashes with another court', async () => {
    const tournamentId = await seedTournament(repos.client);
    const first = await seedCourt(repos.client, tournamentId, { number: 1 });
    await seedCourt(repos.client, tournamentId, { number: 2 });
    await expect(courts.update(first, { number: 2 })).rejects.toBeInstanceOf(ConflictError);
  });

  it('deactivates and reactivates a court', async () => {
    const tournamentId = await seedTournament(repos.client);
    const courtId = await seedCourt(repos.client, tournamentId);
    const inactive = await courts.transitionStatus(courtId, { status: 'INACTIVE' });
    expect(inactive.status).toBe('INACTIVE');
    const active = await courts.transitionStatus(courtId, { status: 'ACTIVE' });
    expect(active.status).toBe('ACTIVE');
  });

  it('is idempotent when transitioning to the current status', async () => {
    const tournamentId = await seedTournament(repos.client);
    const courtId = await seedCourt(repos.client, tournamentId);
    const court = await courts.transitionStatus(courtId, { status: 'ACTIVE' });
    expect(court.status).toBe('ACTIVE');
  });
});

describe('MatchSchedulingService.schedule', () => {
  it('schedules a match on an active court in the same tournament', async () => {
    const { tournamentId, matchId } = await matchInTournament();
    const courtId = await seedCourt(repos.client, tournamentId);
    const match = await scheduling.schedule(matchId, {
      courtId,
      scheduledStartAt: start,
      scheduledEndAt: end,
    });
    expect(match).toMatchObject({ courtId, scheduledStartAt: start, scheduledEndAt: end });
  });

  it('rejects a reversed or zero-length interval', async () => {
    const { tournamentId, matchId } = await matchInTournament();
    const courtId = await seedCourt(repos.client, tournamentId);
    await expect(
      scheduling.schedule(matchId, { courtId, scheduledStartAt: end, scheduledEndAt: start }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
    await expect(
      scheduling.schedule(matchId, { courtId, scheduledStartAt: start, scheduledEndAt: start }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
  });

  it('rejects a court from another tournament', async () => {
    const { matchId } = await matchInTournament();
    const otherTournament = await seedTournament(repos.client);
    const foreignCourt = await seedCourt(repos.client, otherTournament, { number: 9 });
    await expect(
      scheduling.schedule(matchId, {
        courtId: foreignCourt,
        scheduledStartAt: start,
        scheduledEndAt: end,
      }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
  });

  it('rejects an inactive court', async () => {
    const { tournamentId, matchId } = await matchInTournament();
    const courtId = await seedCourt(repos.client, tournamentId, { status: 'INACTIVE' });
    await expect(
      scheduling.schedule(matchId, {
        courtId,
        scheduledStartAt: start,
        scheduledEndAt: end,
      }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
  });

  it('rejects overlapping windows on the same court', async () => {
    const { tournamentId, matchId } = await matchInTournament();
    const courtId = await seedCourt(repos.client, tournamentId);
    await scheduling.schedule(matchId, {
      courtId,
      scheduledStartAt: start,
      scheduledEndAt: end,
    });

    const current = await repos.client.matches.findById(matchId);
    const sibling = await repos.client.matches.create({
      stageId: current?.stageId ?? '',
      sequence: 2,
      roundNumber: null,
      matchNumber: null,
      status: 'SCHEDULED',
    });

    await expect(
      scheduling.schedule(sibling.id, {
        courtId,
        scheduledStartAt: new Date('2026-10-05T10:15:00.000Z'),
        scheduledEndAt: new Date('2026-10-05T10:45:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows back-to-back windows that only touch', async () => {
    const { tournamentId, matchId } = await matchInTournament();
    const courtId = await seedCourt(repos.client, tournamentId);
    await scheduling.schedule(matchId, {
      courtId,
      scheduledStartAt: start,
      scheduledEndAt: end,
    });

    const current = await repos.client.matches.findById(matchId);
    const sibling = await repos.client.matches.create({
      stageId: current?.stageId ?? '',
      sequence: 2,
      roundNumber: null,
      matchNumber: null,
      status: 'SCHEDULED',
    });

    await expect(
      scheduling.schedule(sibling.id, {
        courtId,
        scheduledStartAt: end,
        scheduledEndAt: new Date('2026-10-05T11:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ courtId });
  });

  it('rejects scheduling a completed match', async () => {
    const { tournamentId, matchId } = await matchInTournament();
    const courtId = await seedCourt(repos.client, tournamentId);
    await repos.client.matches.updateStatus(matchId, 'COMPLETED');
    await expect(
      scheduling.schedule(matchId, { courtId, scheduledStartAt: start, scheduledEndAt: end }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects scheduling a cancelled match', async () => {
    const { tournamentId, matchId } = await matchInTournament();
    const courtId = await seedCourt(repos.client, tournamentId);
    await repos.client.matches.updateStatus(matchId, 'CANCELLED');
    await expect(
      scheduling.schedule(matchId, { courtId, scheduledStartAt: start, scheduledEndAt: end }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects rescheduling an in-progress match', async () => {
    const { tournamentId, matchId } = await matchInTournament();
    const courtId = await seedCourt(repos.client, tournamentId);
    await repos.client.matches.updateStatus(matchId, 'IN_PROGRESS');
    await expect(
      scheduling.schedule(matchId, { courtId, scheduledStartAt: start, scheduledEndAt: end }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects an unknown court', async () => {
    const { matchId } = await matchInTournament();
    await expect(
      scheduling.schedule(matchId, {
        courtId: '00000000-0000-0000-0000-000000000000',
        scheduledStartAt: start,
        scheduledEndAt: end,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an unknown match', async () => {
    const tournamentId = await seedTournament(repos.client);
    const courtId = await seedCourt(repos.client, tournamentId);
    await expect(
      scheduling.schedule('00000000-0000-0000-0000-000000000000', {
        courtId,
        scheduledStartAt: start,
        scheduledEndAt: end,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('MatchSchedulingService.unschedule', () => {
  it('clears a future schedule', async () => {
    const { tournamentId, matchId } = await matchInTournament();
    const courtId = await seedCourt(repos.client, tournamentId);
    await scheduling.schedule(matchId, { courtId, scheduledStartAt: start, scheduledEndAt: end });
    const cleared = await scheduling.unschedule(matchId);
    expect(cleared).toMatchObject({
      courtId: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
    });
  });

  it('rejects clearing an in-progress match', async () => {
    const { matchId } = await matchInTournament();
    await repos.client.matches.updateStatus(matchId, 'IN_PROGRESS');
    await expect(scheduling.unschedule(matchId)).rejects.toBeInstanceOf(ConflictError);
  });
});
