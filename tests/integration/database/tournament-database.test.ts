import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@badminton/database';

import {
  createCategory,
  createEntry,
  createMatch,
  createParticipant,
  createPlayer,
  createStage,
  createTeam,
  createTeamMember,
  createTournament,
  databaseTestsRequired,
  isUuid,
  openTestDatabase,
  resetTournamentData,
} from './harness.ts';

/**
 * Phase 2 database integration tests (real PostgreSQL, no Prisma mocks).
 *
 * They assert that the structural guarantees promised by
 * `docs/phase-2-domain-design.md` §10 actually hold in the migrated database:
 * keys, CHECK constraints, partial unique indexes, referential actions and the
 * documented index set. Cross-table service rules (entry format, team size,
 * player-in-two-teams) are deliberately **not** asserted here - they belong to
 * the service layer.
 *
 * The suite talks to a dedicated `<database>_test` database. Without a reachable
 * PostgreSQL it is skipped on a workstation, but a missing database fails the run
 * under CI (`CI` set) or when `REQUIRE_DATABASE_TESTS=1`.
 */

const database = await openTestDatabase();

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

/** Asserts that a rejected operation mentions `fragment` (constraint/index name). */
async function expectRejectionContaining(
  operation: Promise<unknown>,
  fragment: string,
): Promise<void> {
  const error = await rejection(operation);
  expect(String(error)).toContain(fragment);
}

const SUITE_NAME = 'Phase 2 tournament database';

/**
 * Registers the suite for an open database. Kept as a function so the Prisma
 * client is a plain parameter - vitest still executes a `describe.skip`
 * callback during collection, so the client must not be dereferenced there.
 */
function registerDatabaseSuite(prisma: PrismaClient): void {
  describe(SUITE_NAME, () => {
    beforeEach(async () => {
      await resetTournamentData(prisma);
    });

    describe('basic creation', () => {
      it('creates every tournament entity and wires them together', async () => {
        const tournament = await createTournament(prisma, { name: 'Basic Open' });
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const player = await createPlayer(prisma, { name: 'Player A' });
        const partner = await createPlayer(prisma, { name: 'Player B' });
        const team = await createTeam(prisma);
        await createTeamMember(prisma, { teamId: team.id, playerId: player.id, position: 1 });
        await createTeamMember(prisma, { teamId: team.id, playerId: partner.id, position: 2 });
        const entry = await createEntry(prisma, { categoryId: category.id, playerId: player.id });
        const stage = await createStage(prisma, { categoryId: category.id });
        const match = await createMatch(prisma, { stageId: stage.id });
        const participant = await createParticipant(prisma, {
          matchId: match.id,
          entryId: entry.id,
          slot: 1,
        });

        expect(tournament.id).toBeTruthy();
        expect(category.tournamentId).toBe(tournament.id);
        expect(entry.status).toBe('PENDING');
        expect(entry.registeredAt).toBeInstanceOf(Date);
        expect(stage.sequence).toBe(1);
        expect(match.status).toBe('SCHEDULED');
        expect(participant.slot).toBe(1);
      });

      it('generates valid UUID primary keys', async () => {
        const tournament = await createTournament(prisma);
        const player = await createPlayer(prisma);

        expect(isUuid(tournament.id)).toBe(true);
        expect(isUuid(player.id)).toBe(true);
      });

      it('stores all Phase 2 id columns as native PostgreSQL uuid', async () => {
        const rows = await prisma.$queryRaw<{ table_name: string; data_type: string }[]>`
        SELECT table_name, data_type
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND column_name IN ('id', 'tournamentId', 'categoryId', 'playerId', 'teamId', 'stageId', 'entryId')
          AND table_name IN (
            'tournaments', 'tournament_categories', 'players', 'teams',
            'team_members', 'tournament_entries', 'tournament_stages',
            'matches', 'match_participants'
          )
      `;

        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((row) => row.data_type === 'uuid')).toBe(true);
      });

      it('stores tournament calendar dates as PostgreSQL date', async () => {
        const tournament = await createTournament(prisma);
        const rows = await prisma.$queryRaw<{ data_type: string }[]>`
        SELECT data_type
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'tournaments'
          AND column_name IN ('startDate', 'endDate')
      `;

        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.data_type === 'date')).toBe(true);
        expect(tournament.startDate).toBeInstanceOf(Date);
      });
    });

    describe('tournament constraints', () => {
      it('rejects endDate before startDate', async () => {
        await expectRejectionContaining(
          createTournament(prisma, {
            startDate: new Date('2026-10-05T00:00:00.000Z'),
            endDate: new Date('2026-10-03T00:00:00.000Z'),
          }),
          'tournaments_date_order',
        );
      });

      it('accepts endDate equal to startDate', async () => {
        const day = new Date('2026-10-03T00:00:00.000Z');
        const tournament = await createTournament(prisma, { startDate: day, endDate: day });
        expect(tournament.id).toBeTruthy();
      });

      it('rejects an empty name', async () => {
        await expectRejectionContaining(
          createTournament(prisma, { name: '' }),
          'tournaments_name_present',
        );
      });

      it('rejects a whitespace-only name', async () => {
        await expectRejectionContaining(
          createTournament(prisma, { name: '   ' }),
          'tournaments_name_present',
        );
      });

      it('requires a timezone (NOT NULL)', async () => {
        const error = await rejection(
          prisma.$executeRaw`
          INSERT INTO "tournaments" ("id", "name", "startDate", "endDate", "status")
          VALUES (gen_random_uuid(), 'No TZ', CURRENT_DATE, CURRENT_DATE, 'DRAFT')
        `,
        );
        expect(String(error)).toContain('timezone');
      });
    });

    describe('category constraints', () => {
      it.each(['ms', 'Men Singles!', 'TOO-LONG-CODE', ''])(
        'rejects the invalid code %j',
        async (code) => {
          const tournament = await createTournament(prisma);
          await expectRejectionContaining(
            createCategory(prisma, { tournamentId: tournament.id, code }),
            'tournament_categories_code_format',
          );
        },
      );

      it.each(['MS', 'MD', 'XD', 'U17'])('accepts the valid code %s', async (code) => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, {
          tournamentId: tournament.id,
          code,
          name: `Category ${code}`,
        });
        expect(category.code).toBe(code);
      });

      it('rejects a duplicate code within the same tournament', async () => {
        const tournament = await createTournament(prisma);
        await createCategory(prisma, { tournamentId: tournament.id, code: 'MS' });
        await expectRejectionContaining(
          createCategory(prisma, { tournamentId: tournament.id, code: 'MS', name: 'Another' }),
          'tournamentId_code',
        );
      });

      it('rejects a duplicate display name within the same tournament (case-insensitive)', async () => {
        const tournament = await createTournament(prisma);
        await createCategory(prisma, {
          tournamentId: tournament.id,
          code: 'MS',
          name: "Men's Singles",
        });
        await expectRejectionContaining(
          createCategory(prisma, {
            tournamentId: tournament.id,
            code: 'MS2',
            name: "men's singles",
          }),
          'tournament_categories_name_key',
        );
      });

      it('allows the same code and name across different tournaments', async () => {
        const first = await createTournament(prisma, { name: 'Tournament A' });
        const second = await createTournament(prisma, { name: 'Tournament B' });
        await createCategory(prisma, { tournamentId: first.id, code: 'MS', name: "Men's Singles" });
        const other = await createCategory(prisma, {
          tournamentId: second.id,
          code: 'MS',
          name: "Men's Singles",
        });
        expect(other.id).toBeTruthy();
      });
    });

    describe('tournament entry constraints', () => {
      it('rejects an entry with neither owner', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        await expectRejectionContaining(
          createEntry(prisma, { categoryId: category.id }),
          'entries_exactly_one_competitor',
        );
      });

      it('rejects an entry with both owners', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const player = await createPlayer(prisma);
        const team = await createTeam(prisma);
        await expectRejectionContaining(
          createEntry(prisma, { categoryId: category.id, playerId: player.id, teamId: team.id }),
          'entries_exactly_one_competitor',
        );
      });

      it('accepts a player (singles) registration', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const player = await createPlayer(prisma);
        const entry = await createEntry(prisma, { categoryId: category.id, playerId: player.id });
        expect(entry.playerId).toBe(player.id);
        expect(entry.teamId).toBeNull();
      });

      it('accepts a team (doubles) registration', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, {
          tournamentId: tournament.id,
          code: 'MD',
          name: "Men's Doubles",
          format: 'DOUBLES',
        });
        const team = await createTeam(prisma);
        const entry = await createEntry(prisma, { categoryId: category.id, teamId: team.id });
        expect(entry.teamId).toBe(team.id);
        expect(entry.playerId).toBeNull();
      });

      it('rejects a non-positive seed', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const first = await createPlayer(prisma, { name: 'Seed A' });
        const second = await createPlayer(prisma, { name: 'Seed B' });

        await expectRejectionContaining(
          createEntry(prisma, { categoryId: category.id, playerId: first.id, seed: 0 }),
          'entries_seed_positive',
        );
        await expectRejectionContaining(
          createEntry(prisma, { categoryId: category.id, playerId: second.id, seed: -1 }),
          'entries_seed_positive',
        );
      });

      it('accepts a null or positive seed', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const first = await createPlayer(prisma, { name: 'Seed A' });
        const second = await createPlayer(prisma, { name: 'Seed B' });

        const unseeded = await createEntry(prisma, { categoryId: category.id, playerId: first.id });
        const seeded = await createEntry(prisma, {
          categoryId: category.id,
          playerId: second.id,
          seed: 1,
        });

        expect(unseeded.seed).toBeNull();
        expect(seeded.seed).toBe(1);
      });
    });

    describe('registration uniqueness', () => {
      it('rejects the same player registered twice in one category', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const player = await createPlayer(prisma);
        await createEntry(prisma, { categoryId: category.id, playerId: player.id });
        await expectRejectionContaining(
          createEntry(prisma, { categoryId: category.id, playerId: player.id }),
          'entries_category_player_key',
        );
      });

      it('rejects the same team registered twice in one category', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, {
          tournamentId: tournament.id,
          code: 'MD',
          name: "Men's Doubles",
          format: 'DOUBLES',
        });
        const team = await createTeam(prisma);
        await createEntry(prisma, { categoryId: category.id, teamId: team.id });
        await expectRejectionContaining(
          createEntry(prisma, { categoryId: category.id, teamId: team.id }),
          'entries_category_team_key',
        );
      });

      it('allows the same player in a different category', async () => {
        const tournament = await createTournament(prisma);
        const singles = await createCategory(prisma, { tournamentId: tournament.id, code: 'MS' });
        const other = await createCategory(prisma, {
          tournamentId: tournament.id,
          code: 'MS-B',
          name: 'Singles B',
        });
        const player = await createPlayer(prisma);
        await createEntry(prisma, { categoryId: singles.id, playerId: player.id });
        const second = await createEntry(prisma, { categoryId: other.id, playerId: player.id });
        expect(second.id).toBeTruthy();
      });

      it('allows the same team in a different category', async () => {
        const tournament = await createTournament(prisma);
        const first = await createCategory(prisma, {
          tournamentId: tournament.id,
          code: 'MD',
          name: "Men's Doubles",
          format: 'DOUBLES',
        });
        const second = await createCategory(prisma, {
          tournamentId: tournament.id,
          code: 'XD',
          name: 'Mixed Doubles',
          format: 'DOUBLES',
          gender: 'MIXED',
        });
        const team = await createTeam(prisma);
        await createEntry(prisma, { categoryId: first.id, teamId: team.id });
        const other = await createEntry(prisma, { categoryId: second.id, teamId: team.id });
        expect(other.id).toBeTruthy();
      });
    });

    describe('team membership', () => {
      it('rejects the same player twice in one team', async () => {
        const team = await createTeam(prisma);
        const player = await createPlayer(prisma);
        await createTeamMember(prisma, { teamId: team.id, playerId: player.id, position: 1 });
        await expectRejectionContaining(
          createTeamMember(prisma, { teamId: team.id, playerId: player.id, position: 2 }),
          'teamId_playerId',
        );
      });

      // The category-specific "one team per category" rule is a service invariant
      // (design §22.1) and is intentionally not asserted at the database level.
      it('allows the same player in different teams', async () => {
        const player = await createPlayer(prisma);
        const first = await createTeam(prisma, 'Team One');
        const second = await createTeam(prisma, 'Team Two');
        await createTeamMember(prisma, { teamId: first.id, playerId: player.id });
        const membership = await createTeamMember(prisma, {
          teamId: second.id,
          playerId: player.id,
        });
        expect(membership.id).toBeTruthy();
      });
    });

    describe('match participants', () => {
      async function matchFixture(): Promise<{ matchId: string; entryIds: [string, string] }> {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const first = await createPlayer(prisma, { name: 'Player A' });
        const second = await createPlayer(prisma, { name: 'Player B' });
        const entryOne = await createEntry(prisma, { categoryId: category.id, playerId: first.id });
        const entryTwo = await createEntry(prisma, {
          categoryId: category.id,
          playerId: second.id,
        });
        const stage = await createStage(prisma, { categoryId: category.id });
        const match = await createMatch(prisma, { stageId: stage.id });
        return { matchId: match.id, entryIds: [entryOne.id, entryTwo.id] };
      }

      it('accepts slots 1 and 2', async () => {
        const { matchId, entryIds } = await matchFixture();
        const one = await createParticipant(prisma, {
          matchId,
          entryId: entryIds[0],
          slot: 1,
        });
        const two = await createParticipant(prisma, {
          matchId,
          entryId: entryIds[1],
          slot: 2,
        });
        expect([one.slot, two.slot]).toEqual([1, 2]);
      });

      it.each([0, 3])('rejects the invalid slot %i', async (slot) => {
        const { matchId, entryIds } = await matchFixture();
        await expectRejectionContaining(
          createParticipant(prisma, { matchId, entryId: entryIds[0], slot }),
          'match_participants_slot_valid',
        );
      });

      it('rejects two participants sharing a slot in the same match', async () => {
        const { matchId, entryIds } = await matchFixture();
        await createParticipant(prisma, { matchId, entryId: entryIds[0], slot: 1 });
        await expectRejectionContaining(
          createParticipant(prisma, { matchId, entryId: entryIds[1], slot: 1 }),
          'matchId_slot',
        );
      });

      it('rejects the same entry appearing twice in one match', async () => {
        const { matchId, entryIds } = await matchFixture();
        await createParticipant(prisma, { matchId, entryId: entryIds[0], slot: 1 });
        await expectRejectionContaining(
          createParticipant(prisma, { matchId, entryId: entryIds[0], slot: 2 }),
          'matchId_entryId',
        );
      });
    });

    describe('referential integrity', () => {
      it('cannot delete a tournament that contains categories', async () => {
        const tournament = await createTournament(prisma);
        await createCategory(prisma, { tournamentId: tournament.id });
        const error = await rejection(prisma.tournament.delete({ where: { id: tournament.id } }));
        expect(String(error)).toContain('tournament_categories_tournamentId_fkey');
      });

      it('cannot delete a category that contains entries', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const player = await createPlayer(prisma);
        await createEntry(prisma, { categoryId: category.id, playerId: player.id });
        const error = await rejection(
          prisma.tournamentCategory.delete({ where: { id: category.id } }),
        );
        expect(String(error)).toContain('tournament_entries_categoryId_fkey');
      });

      it('cannot delete a player referenced by an entry', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const player = await createPlayer(prisma);
        await createEntry(prisma, { categoryId: category.id, playerId: player.id });
        const error = await rejection(prisma.player.delete({ where: { id: player.id } }));
        expect(String(error)).toContain('tournament_entries_playerId_fkey');
      });

      it('cannot delete a team referenced by an entry', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, {
          tournamentId: tournament.id,
          code: 'MD',
          name: "Men's Doubles",
          format: 'DOUBLES',
        });
        const team = await createTeam(prisma);
        await createEntry(prisma, { categoryId: category.id, teamId: team.id });
        const error = await rejection(prisma.team.delete({ where: { id: team.id } }));
        expect(String(error)).toContain('tournament_entries_teamId_fkey');
      });

      it('deleting a team cascades to its members', async () => {
        const team = await createTeam(prisma);
        const player = await createPlayer(prisma);
        await createTeamMember(prisma, { teamId: team.id, playerId: player.id });

        await prisma.team.delete({ where: { id: team.id } });

        expect(await prisma.teamMember.count({ where: { teamId: team.id } })).toBe(0);
        // The player itself survives the cascade.
        expect(await prisma.player.count({ where: { id: player.id } })).toBe(1);
      });

      it('cannot delete a player referenced by a team member', async () => {
        const team = await createTeam(prisma);
        const player = await createPlayer(prisma);
        await createTeamMember(prisma, { teamId: team.id, playerId: player.id });
        const error = await rejection(prisma.player.delete({ where: { id: player.id } }));
        expect(String(error)).toContain('team_members_playerId_fkey');
      });

      it('cannot delete a category that contains stages', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        await createStage(prisma, { categoryId: category.id });
        const error = await rejection(
          prisma.tournamentCategory.delete({ where: { id: category.id } }),
        );
        expect(String(error)).toContain('tournament_stages_categoryId_fkey');
      });

      it('cannot delete a stage that contains matches', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const stage = await createStage(prisma, { categoryId: category.id });
        await createMatch(prisma, { stageId: stage.id });
        const error = await rejection(prisma.tournamentStage.delete({ where: { id: stage.id } }));
        expect(String(error)).toContain('matches_stageId_fkey');
      });

      it('deleting a match cascades to its participants', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const player = await createPlayer(prisma);
        const entry = await createEntry(prisma, { categoryId: category.id, playerId: player.id });
        const stage = await createStage(prisma, { categoryId: category.id });
        const match = await createMatch(prisma, { stageId: stage.id });
        await createParticipant(prisma, { matchId: match.id, entryId: entry.id, slot: 1 });

        await prisma.match.delete({ where: { id: match.id } });

        expect(await prisma.matchParticipant.count({ where: { matchId: match.id } })).toBe(0);
        // The entry survives: only the match-owned row cascades.
        expect(await prisma.tournamentEntry.count({ where: { id: entry.id } })).toBe(1);
      });

      it('cannot delete an entry referenced by a match participant', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const player = await createPlayer(prisma);
        const entry = await createEntry(prisma, { categoryId: category.id, playerId: player.id });
        const stage = await createStage(prisma, { categoryId: category.id });
        const match = await createMatch(prisma, { stageId: stage.id });
        await createParticipant(prisma, { matchId: match.id, entryId: entry.id, slot: 1 });
        const error = await rejection(prisma.tournamentEntry.delete({ where: { id: entry.id } }));
        expect(String(error)).toContain('match_participants_entryId_fkey');
      });
    });

    describe('partial unique indexes', () => {
      it('rejects two active tournaments with the same name', async () => {
        await createTournament(prisma, { name: 'Summer Open', status: 'DRAFT' });
        await expectRejectionContaining(
          createTournament(prisma, { name: 'Summer Open', status: 'REGISTRATION_OPEN' }),
          'tournaments_active_name_key',
        );
      });

      it('allows a completed tournament to reuse a live name', async () => {
        await createTournament(prisma, { name: 'Summer Open', status: 'DRAFT' });
        const completed = await createTournament(prisma, {
          name: 'Summer Open',
          status: 'COMPLETED',
        });
        expect(completed.id).toBeTruthy();
      });

      it('allows a cancelled tournament to reuse a live name', async () => {
        await createTournament(prisma, { name: 'Summer Open', status: 'DRAFT' });
        const cancelled = await createTournament(prisma, {
          name: 'Summer Open',
          status: 'CANCELLED',
        });
        expect(cancelled.id).toBeTruthy();
      });

      it('rejects the same email regardless of case', async () => {
        await createPlayer(prisma, { name: 'First', email: 'Player.One@Example.test' });
        await expectRejectionContaining(
          createPlayer(prisma, { name: 'Second', email: 'player.one@example.test' }),
          'players_email_key',
        );
      });

      it('allows multiple players without an email', async () => {
        await createPlayer(prisma, { name: 'No Email A' });
        const second = await createPlayer(prisma, { name: 'No Email B' });
        expect(second.id).toBeTruthy();
      });

      it('rejects the same phone number', async () => {
        await createPlayer(prisma, { name: 'First', phone: '+91-9000000000' });
        await expectRejectionContaining(
          createPlayer(prisma, { name: 'Second', phone: '+91-9000000000' }),
          'players_phone_key',
        );
      });

      it('allows multiple players without a phone number', async () => {
        await createPlayer(prisma, { name: 'No Phone A' });
        const second = await createPlayer(prisma, { name: 'No Phone B' });
        expect(second.id).toBeTruthy();
      });
    });

    describe('sequencing uniqueness', () => {
      it('rejects two stages with the same sequence in a category', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        await createStage(prisma, { categoryId: category.id, sequence: 1 });
        await expectRejectionContaining(
          createStage(prisma, { categoryId: category.id, sequence: 1, name: 'Duplicate' }),
          'categoryId_sequence',
        );
      });

      it('rejects two matches with the same sequence in a stage', async () => {
        const tournament = await createTournament(prisma);
        const category = await createCategory(prisma, { tournamentId: tournament.id });
        const stage = await createStage(prisma, { categoryId: category.id });
        await createMatch(prisma, { stageId: stage.id, sequence: 1 });
        await expectRejectionContaining(
          createMatch(prisma, { stageId: stage.id, sequence: 1 }),
          'stageId_sequence',
        );
      });
    });

    describe('index presence', () => {
      it('creates every index required by the design', async () => {
        const rows = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = current_schema()
      `;
        const names = new Set(rows.map((row) => row.indexname));

        const required = [
          'tournaments_status_idx',
          'tournaments_startDate_idx',
          'tournaments_active_name_key',
          'tournament_categories_tournamentId_code_key',
          'tournament_categories_name_key',
          'players_name_idx',
          'players_email_key',
          'players_phone_key',
          'team_members_teamId_playerId_key',
          'team_members_playerId_idx',
          'tournament_entries_categoryId_idx',
          'tournament_entries_playerId_idx',
          'tournament_entries_teamId_idx',
          'entries_category_player_key',
          'entries_category_team_key',
          'tournament_stages_categoryId_sequence_key',
          'matches_stageId_sequence_key',
          'matches_status_idx',
          'match_participants_matchId_slot_key',
          'match_participants_matchId_entryId_key',
          'match_participants_entryId_idx',
        ];

        expect(required.filter((name) => !names.has(name))).toEqual([]);
      });

      it('does not create unexpected tournament-domain tables', async () => {
        const rows = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name <> '_prisma_migrations'
        ORDER BY table_name
      `;
        const names = rows.map((row) => row.table_name).sort();
        expect(names).toEqual([
          'match_participants',
          'matches',
          'players',
          'system_metadata',
          'team_members',
          'teams',
          'tournament_categories',
          'tournament_entries',
          'tournament_stages',
          'tournaments',
        ]);
      });
    });
  });
}

if (database) {
  registerDatabaseSuite(database.prisma);
} else {
  // A file that registers no suite fails Vitest with "No test suite found".
  // Register an explicit skip so a database-less workstation stays green while
  // still surfacing that the suite did not run. CI never reaches this branch.
  describe.skip(`${SUITE_NAME} (skipped: no database)`, () => {
    it('requires PostgreSQL', () => {
      expect(databaseTestsRequired()).toBe(false);
    });
  });
}
