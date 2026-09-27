import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createMatchService,
  createPlayerService,
  createTeamService,
  createTournamentCategoryService,
  createTournamentEntryService,
  createTournamentService,
  createTournamentStageService,
} from '@badminton/application';
import { createPrismaUnitOfWork } from '@badminton/infrastructure';

import {
  createTournament as createTournamentRow,
  openTestDatabase,
  resetTournamentData,
} from '../database/harness.ts';

/**
 * Application + infrastructure integration tests (real PostgreSQL).
 *
 * These drive the actual services through the Prisma unit of work, so they
 * exercise the repository adapters and the constraint-to-application-error
 * translation, not just the database schema. Skipped when no database is
 * reachable; required under CI.
 *
 * The schema suite uses the `<database>_test` database; this suite uses
 * `<database>_app_test` so the two can run in parallel without resetting each
 * other's rows.
 *
 * Each test arranges tournament/category state through the services themselves
 * so the whole stack - service, adapter and database - is exercised together.
 */

const database = await openTestDatabase('_app_test');

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
  throw new Error('Expected the operation to reject, but it succeeded.');
}

function codeOf(error: unknown): string | undefined {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

describe.skipIf(!database)('application services against PostgreSQL', () => {
  if (!database) {
    // Never reached: `skipIf` skips the suite when the database is absent. This
    // guard narrows the type for the collection-time service wiring below.
    throw new Error('PostgreSQL is required for the application integration tests.');
  }

  const prisma = database.prisma;
  const unitOfWork = createPrismaUnitOfWork(prisma);

  const tournaments = createTournamentService(unitOfWork);
  const categories = createTournamentCategoryService(unitOfWork);
  const players = createPlayerService(unitOfWork);
  const teams = createTeamService(unitOfWork);
  const entries = createTournamentEntryService(unitOfWork);
  const matches = createMatchService(unitOfWork);
  const stages = createTournamentStageService(unitOfWork);

  beforeEach(async () => {
    await resetTournamentData(prisma);
  });

  async function openSinglesTournament(): Promise<string> {
    const tournament = await tournaments.create({
      name: 'Integration Open',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-03T00:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    await tournaments.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });
    return tournament.id;
  }

  async function openCategory(
    tournamentId: string,
    format: 'SINGLES' | 'DOUBLES',
    code: string,
  ): Promise<string> {
    const category = await categories.create(tournamentId, {
      name: `Category ${code}`,
      code,
      format,
    });
    await categories.transitionStatus(category.id, { status: 'OPEN' });
    return category.id;
  }

  describe('tournament persistence', () => {
    it('persists a tournament and reloads it', async () => {
      const tournament = await tournaments.create({
        name: 'Persisted',
        startDate: new Date('2026-11-01T00:00:00.000Z'),
        endDate: new Date('2026-11-02T00:00:00.000Z'),
        timezone: 'Asia/Kolkata',
      });
      const reloaded = await tournaments.getById(tournament.id);
      expect(reloaded.name).toBe('Persisted');
      expect(reloaded.status).toBe('DRAFT');
    });

    it('surfaces a duplicate live name as a ConflictError, not a raw Prisma error', async () => {
      await createTournamentRow(prisma, { name: 'Duplicate Name', status: 'DRAFT' });
      const error = await rejection(
        tournaments.create({
          name: 'Duplicate Name',
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          endDate: new Date('2026-10-03T00:00:00.000Z'),
          timezone: 'Asia/Kolkata',
        }),
      );
      expect(codeOf(error)).toBe('CONFLICT');
    });

    it('translates an invalid lifecycle transition', async () => {
      const tournament = await tournaments.create({
        name: 'Lifecycle',
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        endDate: new Date('2026-10-03T00:00:00.000Z'),
        timezone: 'Asia/Kolkata',
      });
      const error = await rejection(
        tournaments.transitionStatus(tournament.id, { status: 'IN_PROGRESS' }),
      );
      expect(codeOf(error)).toBe('INVALID_STATE_TRANSITION');
    });
  });

  describe('category persistence', () => {
    it('persists a normalized code', async () => {
      const tournamentId = await openSinglesTournament();
      const category = await categories.create(tournamentId, {
        name: 'Doubles',
        code: ' md ',
        format: 'DOUBLES',
      });
      expect(category.code).toBe('MD');
    });

    it('translates a duplicate category code to ConflictError', async () => {
      const tournamentId = await openSinglesTournament();
      await openCategory(tournamentId, 'SINGLES', 'MS');
      const error = await rejection(
        categories.create(tournamentId, { name: 'Other', code: 'ms', format: 'SINGLES' }),
      );
      expect(codeOf(error)).toBe('CONFLICT');
    });

    it('enforces the tournament foreign key', async () => {
      const error = await rejection(
        categories.create('11111111-1111-4111-8111-111111111111', {
          name: 'Orphan',
          code: 'OR',
          format: 'SINGLES',
        }),
      );
      expect(codeOf(error)).toBe('NOT_FOUND');
    });
  });

  describe('player persistence and contacts', () => {
    it('normalizes contacts and translates duplicate email to ConflictError', async () => {
      await players.create({ name: 'First', email: 'dup@example.com' });
      const error = await rejection(players.create({ name: 'Second', email: 'DUP@example.com' }));
      expect(codeOf(error)).toBe('CONFLICT');
    });

    it('translates duplicate phone to ConflictError', async () => {
      await players.create({ name: 'First', phone: '+919000000001' });
      const error = await rejection(players.create({ name: 'Second', phone: '+91-9000000001' }));
      expect(codeOf(error)).toBe('CONFLICT');
    });
  });

  describe('team persistence', () => {
    it('creates a team with members atomically', async () => {
      const first = await players.create({ name: 'A' });
      const second = await players.create({ name: 'B' });
      const team = await teams.create({
        name: 'Pair',
        memberPlayerIds: [first.id, second.id],
      });
      const members = await teams.listMembers(team.id);
      expect(members).toHaveLength(2);
    });

    it('rolls back the whole team when a member is missing', async () => {
      const before = await prisma.team.count();
      const error = await rejection(
        teams.create({ name: 'Broken', memberPlayerIds: ['11111111-1111-4111-8111-111111111111'] }),
      );
      expect(codeOf(error)).toBe('NOT_FOUND');
      expect(await prisma.team.count()).toBe(before);
    });

    it('translates a duplicate member to ConflictError', async () => {
      const player = await players.create({ name: 'A' });
      const team = await teams.create({ name: 'Solo', memberPlayerIds: [player.id] });
      const error = await rejection(teams.addMember(team.id, { playerId: player.id }));
      expect(codeOf(error)).toBe('CONFLICT');
    });
  });

  describe('tournament entry registration', () => {
    it('registers a singles entry and rejects a duplicate with ConflictError', async () => {
      const tournamentId = await openSinglesTournament();
      const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
      const player = await players.create({ name: 'Solo' });

      const entry = await entries.register({ categoryId, playerId: player.id });
      expect(entry.playerId).toBe(player.id);

      const error = await rejection(entries.register({ categoryId, playerId: player.id }));
      expect(codeOf(error)).toBe('CONFLICT');
    });

    it('rejects a team into a singles category (format mismatch)', async () => {
      const tournamentId = await openSinglesTournament();
      const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
      const a = await players.create({ name: 'A' });
      const b = await players.create({ name: 'B' });
      const team = await teams.create({ name: 'Pair', memberPlayerIds: [a.id, b.id] });

      const error = await rejection(entries.register({ categoryId, teamId: team.id }));
      expect(codeOf(error)).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('registers a doubles team and rejects a player in two teams', async () => {
      const tournamentId = await openSinglesTournament();
      const categoryId = await openCategory(tournamentId, 'DOUBLES', 'MD');
      const shared = await players.create({ name: 'Shared' });
      const p1 = await players.create({ name: 'P1' });
      const p2 = await players.create({ name: 'P2' });

      const teamOne = await teams.create({ name: 'One', memberPlayerIds: [shared.id, p1.id] });
      const teamTwo = await teams.create({ name: 'Two', memberPlayerIds: [shared.id, p2.id] });

      await entries.register({ categoryId, teamId: teamOne.id });
      const error = await rejection(entries.register({ categoryId, teamId: teamTwo.id }));
      expect(codeOf(error)).toBe('CONFLICT');
    });

    it('withdraws an entry then refuses a duplicate re-registration', async () => {
      const tournamentId = await openSinglesTournament();
      const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
      const player = await players.create({ name: 'Solo' });
      const entry = await entries.register({ categoryId, playerId: player.id });
      await entries.withdraw(entry.id);

      const error = await rejection(entries.register({ categoryId, playerId: player.id }));
      expect(codeOf(error)).toBe('CONFLICT');
    });

    it('rejects registration when the tournament is not open', async () => {
      const tournament = await tournaments.create({
        name: 'Closed',
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        endDate: new Date('2026-10-03T00:00:00.000Z'),
        timezone: 'Asia/Kolkata',
      });
      const category = await categories.create(tournament.id, {
        name: 'Singles',
        code: 'MS',
        format: 'SINGLES',
      });
      await categories.transitionStatus(category.id, { status: 'OPEN' });
      const player = await players.create({ name: 'Solo' });

      const error = await rejection(
        entries.register({ categoryId: category.id, playerId: player.id }),
      );
      expect(codeOf(error)).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('lets concurrent duplicate registrations resolve to one entry and one conflict', async () => {
      const tournamentId = await openSinglesTournament();
      const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
      const player = await players.create({ name: 'Racer' });

      // Two registrations race. The pre-check may pass for both, so the database
      // partial unique index is the real arbiter; the loser must receive a
      // controlled ConflictError rather than a raw driver error or a second row.
      const results = await Promise.allSettled([
        entries.register({ categoryId, playerId: player.id }),
        entries.register({ categoryId, playerId: player.id }),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const loser = rejected[0] as PromiseRejectedResult;
      expect(codeOf(loser.reason)).toBe('CONFLICT');

      expect(
        await prisma.tournamentEntry.count({ where: { categoryId, playerId: player.id } }),
      ).toBe(1);
    });
  });

  describe('stage and match persistence', () => {
    it('translates a duplicate stage sequence to ConflictError', async () => {
      const tournamentId = await openSinglesTournament();
      const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');

      await stages.create(categoryId, { name: 'Group', type: 'GROUP', sequence: 1 });
      const error = await rejection(
        stages.create(categoryId, { name: 'Knockout', type: 'KNOCKOUT', sequence: 1 }),
      );
      expect(codeOf(error)).toBe('CONFLICT');
    });

    it('translates a duplicate match sequence to ConflictError', async () => {
      const tournamentId = await openSinglesTournament();
      const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
      const stage = await prisma.tournamentStage.create({
        data: { categoryId, name: 'Group', type: 'GROUP', sequence: 1 },
      });

      await matches.create(stage.id, { sequence: 1 });
      const error = await rejection(matches.create(stage.id, { sequence: 1 }));
      expect(codeOf(error)).toBe('CONFLICT');
    });

    it('translates a duplicate participant slot and rejects a cross-category entry', async () => {
      const tournamentId = await openSinglesTournament();
      const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
      const otherCategoryId = await openCategory(tournamentId, 'SINGLES', 'WS');
      const stage = await prisma.tournamentStage.create({
        data: { categoryId, name: 'Group', type: 'GROUP', sequence: 1 },
      });
      const match = await matches.create(stage.id, { sequence: 1 });

      const playerOne = await players.create({ name: 'P1' });
      const playerTwo = await players.create({ name: 'P2' });
      const otherPlayer = await players.create({ name: 'Other' });

      const entryOne = await entries.register({ categoryId, playerId: playerOne.id });
      const entryTwo = await entries.register({ categoryId, playerId: playerTwo.id });
      const foreignEntry = await entries.register({
        categoryId: otherCategoryId,
        playerId: otherPlayer.id,
      });

      await matches.addParticipant(match.id, { entryId: entryOne.id, slot: 1 });
      const slotError = await rejection(
        matches.addParticipant(match.id, { entryId: entryTwo.id, slot: 1 }),
      );
      expect(codeOf(slotError)).toBe('CONFLICT');

      const foreignError = await rejection(
        matches.addParticipant(match.id, { entryId: foreignEntry.id, slot: 2 }),
      );
      expect(codeOf(foreignError)).toBe('VALIDATION_ERROR');
    });
  });
});
