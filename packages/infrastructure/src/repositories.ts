import type {
  CreateCategoryData,
  CreateCourtData,
  CreateEntryData,
  CreateMatchData,
  CreateMatchGameData,
  CreateMatchParticipantData,
  CreatePlayerData,
  CreateRealtimeEventData,
  CreateStageData,
  CreateTeamData,
  CreateTeamMemberData,
  CreateTournamentData,
  CourtRepository,
  ListPage,
  ListQuery,
  MatchGameRepository,
  MatchParticipantRepository,
  MatchRepository,
  MatchScheduleData,
  PlayerRepository,
  RealtimeEventRepository,
  RepositoryClient,
  TeamMemberRepository,
  TeamRepository,
  TeamWithMemberCount,
  TournamentCategoryRepository,
  TournamentEntryRepository,
  TournamentRepository,
  TournamentStageRepository,
  UnitOfWork,
  UpdateCategoryData,
  UpdateCourtData,
  UpdateMatchData,
  UpdatePlayerData,
  UpdateStageData,
  UpdateTeamData,
  UpdateTournamentData,
} from '@badminton/application';
import { Prisma } from '@badminton/database';
import type { PrismaClient, TransactionClient } from '@badminton/database';

import { translatePersistenceErrors } from './errors.ts';
import {
  toCourt,
  toMatch,
  toMatchGame,
  toMatchParticipant,
  toPlayer,
  toRealtimeEvent,
  toTeam,
  toTeamMember,
  toTournament,
  toTournamentCategory,
  toTournamentEntry,
  toTournamentStage,
} from './mappers.ts';

/**
 * Prisma implementations of the repository ports.
 *
 * These adapters contain no business rules, no HTTP concerns and no Zod
 * validation. They translate known persistence failures into application errors
 * and map rows onto domain types. Both `PrismaClient` and the interactive
 * transaction client expose the same model delegates, so one implementation
 * serves each.
 */

type Db = PrismaClient | TransactionClient;

const UNIQUE_LOOKUP = { take: 1 } as const;

/**
 * Turns a cursor-paginated `findMany` result into a `ListPage`.
 *
 * The repository reads `limit + 1` rows: the extra row proves whether another
 * page exists without a second `count` query. `nextCursor` is the last returned
 * row's id, or `null` on the final page.
 */
function toPage<T extends { readonly id: string }>(rows: readonly T[], limit: number): ListPage<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const hasMore = rows.length > limit;
  return { items, nextCursor: hasMore && last ? last.id : null };
}

function createTournamentRepository(db: Db): TournamentRepository {
  return {
    create(data: CreateTournamentData) {
      return translatePersistenceErrors(async () =>
        toTournament(await db.tournament.create({ data })),
      );
    },
    findById(id: string) {
      return translatePersistenceErrors(async () => {
        const row = await db.tournament.findUnique({ where: { id } });
        return row ? toTournament(row) : undefined;
      });
    },
    listPage(query: ListQuery) {
      return translatePersistenceErrors(async () => {
        // Prisma expands the `id` cursor into a keyset predicate over the whole
        // (createdAt, id) ordering - it looks the cursor row's `createdAt` up in
        // a subquery - so `skip: 1` resumes strictly after the previous page
        // even when `createdAt` values differ or tie. The `id desc` tiebreaker
        // is what makes that predicate unique; without it Prisma would emit a
        // non-unique `createdAt <= cursor` comparison that can skip or repeat
        // rows. Prisma implements the cursor by skipping the cursor row itself,
        // so the SQL carries `OFFSET $skip`, but `skip` is bounded to 0/1 - a
        // constant-time skip of the single cursor row, never an arbitrary
        // `OFFSET page * size` that grows with the page number. Newest first.
        const rows = await db.tournament.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit + 1,
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        });
        return toPage(rows.map(toTournament), query.limit);
      });
    },
    update(id: string, data: UpdateTournamentData) {
      return translatePersistenceErrors(async () =>
        toTournament(await db.tournament.update({ where: { id }, data })),
      );
    },
    updateStatus(id, status) {
      return translatePersistenceErrors(async () =>
        toTournament(await db.tournament.update({ where: { id }, data: { status } })),
      );
    },
  };
}

function createCategoryRepository(db: Db): TournamentCategoryRepository {
  return {
    create(data: CreateCategoryData) {
      return translatePersistenceErrors(async () =>
        toTournamentCategory(await db.tournamentCategory.create({ data })),
      );
    },
    findById(id: string) {
      return translatePersistenceErrors(async () => {
        const row = await db.tournamentCategory.findUnique({ where: { id } });
        return row ? toTournamentCategory(row) : undefined;
      });
    },
    listByTournament(tournamentId: string) {
      return translatePersistenceErrors(async () => {
        const rows = await db.tournamentCategory.findMany({
          where: { tournamentId },
          orderBy: { createdAt: 'asc' },
        });
        return rows.map(toTournamentCategory);
      });
    },
    update(id: string, data: UpdateCategoryData) {
      return translatePersistenceErrors(async () =>
        toTournamentCategory(await db.tournamentCategory.update({ where: { id }, data })),
      );
    },
    updateStatus(id, status) {
      return translatePersistenceErrors(async () =>
        toTournamentCategory(
          await db.tournamentCategory.update({ where: { id }, data: { status } }),
        ),
      );
    },
    countEntries(categoryId: string) {
      return translatePersistenceErrors(async () =>
        db.tournamentEntry.count({ where: { categoryId } }),
      );
    },
  };
}

function createPlayerRepository(db: Db): PlayerRepository {
  return {
    create(data: CreatePlayerData) {
      return translatePersistenceErrors(async () => toPlayer(await db.player.create({ data })));
    },
    findById(id: string) {
      return translatePersistenceErrors(async () => {
        const row = await db.player.findUnique({ where: { id } });
        return row ? toPlayer(row) : undefined;
      });
    },
    findByEmail(email: string) {
      return translatePersistenceErrors(async () => {
        // The database compares email case-insensitively; the service supplies a
        // normalized (lower-case) value, so a direct equality match is correct.
        const row = await db.player.findFirst({ where: { email }, ...UNIQUE_LOOKUP });
        return row ? toPlayer(row) : undefined;
      });
    },
    findByPhone(phone: string) {
      return translatePersistenceErrors(async () => {
        const row = await db.player.findFirst({ where: { phone }, ...UNIQUE_LOOKUP });
        return row ? toPlayer(row) : undefined;
      });
    },
    listPage(query: ListQuery) {
      return translatePersistenceErrors(async () => {
        // Same keyset mechanism as the tournament list: the unique `id` cursor
        // plus a bounded `skip: 1` resumes strictly after the previous page
        // under the (createdAt, id) ordering, so differing or tied `createdAt`
        // values are handled correctly. The `skip` only ever drops the single
        // cursor row; it is never an arbitrary `OFFSET page * size`. Newest
        // first.
        const rows = await db.player.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit + 1,
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        });
        return toPage(rows.map(toPlayer), query.limit);
      });
    },
    async listByIds(ids: readonly string[]) {
      return translatePersistenceErrors(async () => {
        if (ids.length === 0) {
          return [];
        }
        const rows = await db.player.findMany({ where: { id: { in: [...ids] } } });
        return rows.map(toPlayer);
      });
    },
    update(id: string, data: UpdatePlayerData) {
      return translatePersistenceErrors(async () =>
        toPlayer(await db.player.update({ where: { id }, data })),
      );
    },
  };
}

function createTeamRepository(db: Db): TeamRepository {
  return {
    create(data: CreateTeamData) {
      return translatePersistenceErrors(async () => toTeam(await db.team.create({ data })));
    },
    findById(id: string) {
      return translatePersistenceErrors(async () => {
        const row = await db.team.findUnique({ where: { id } });
        return row ? toTeam(row) : undefined;
      });
    },
    async listPageWithMemberCount(query: ListQuery) {
      return translatePersistenceErrors(async () => {
        // One page of teams (same keyset cursor over (createdAt, id) as the
        // tournament and player lists), then one grouped `count` over just those
        // team ids - the member count is never fetched with a query per team.
        const rows = await db.team.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit + 1,
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        });
        const page = toPage(rows.map(toTeam), query.limit);
        const counts = await countTeamMembers(
          db,
          page.items.map((team) => team.id),
        );
        const items: TeamWithMemberCount[] = page.items.map((team) => ({
          team,
          memberCount: counts.get(team.id) ?? 0,
        }));
        return { items, nextCursor: page.nextCursor };
      });
    },
    async listByIds(ids: readonly string[]) {
      return translatePersistenceErrors(async () => {
        if (ids.length === 0) {
          return [];
        }
        const rows = await db.team.findMany({ where: { id: { in: [...ids] } } });
        return rows.map(toTeam);
      });
    },
    update(id: string, data: UpdateTeamData) {
      return translatePersistenceErrors(async () =>
        toTeam(await db.team.update({ where: { id }, data })),
      );
    },
  };
}

/** Grouped member counts for the given teams; empty input issues no query. */
async function countTeamMembers(
  db: Db,
  teamIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (teamIds.length === 0) {
    return new Map();
  }
  const grouped = await db.teamMember.groupBy({
    by: ['teamId'],
    where: { teamId: { in: [...teamIds] } },
    _count: { _all: true },
  });
  return new Map(grouped.map((group) => [group.teamId, group._count._all]));
}

function createTeamMemberRepository(db: Db): TeamMemberRepository {
  return {
    create(data: CreateTeamMemberData) {
      return translatePersistenceErrors(async () =>
        toTeamMember(await db.teamMember.create({ data })),
      );
    },
    async listByTeam(teamId: string) {
      return translatePersistenceErrors(async () => {
        const rows = await db.teamMember.findMany({
          where: { teamId },
          orderBy: { position: 'asc' },
        });
        return rows.map(toTeamMember);
      });
    },
    async findMembership(teamId: string, playerId: string) {
      return translatePersistenceErrors(async () => {
        const row = await db.teamMember.findUnique({
          where: { teamId_playerId: { teamId, playerId } },
        });
        return row ? toTeamMember(row) : undefined;
      });
    },
    remove(teamId: string, playerId: string) {
      return translatePersistenceErrors(async () => {
        await db.teamMember.delete({ where: { teamId_playerId: { teamId, playerId } } });
      });
    },
  };
}

function createEntryRepository(db: Db): TournamentEntryRepository {
  return {
    create(data: CreateEntryData) {
      return translatePersistenceErrors(async () =>
        toTournamentEntry(await db.tournamentEntry.create({ data })),
      );
    },
    async findById(id: string) {
      return translatePersistenceErrors(async () => {
        const row = await db.tournamentEntry.findUnique({ where: { id } });
        return row ? toTournamentEntry(row) : undefined;
      });
    },
    async findByCategoryAndPlayer(categoryId: string, playerId: string) {
      return translatePersistenceErrors(async () => {
        const row = await db.tournamentEntry.findFirst({
          where: { categoryId, playerId },
          ...UNIQUE_LOOKUP,
        });
        return row ? toTournamentEntry(row) : undefined;
      });
    },
    async findByCategoryAndTeam(categoryId: string, teamId: string) {
      return translatePersistenceErrors(async () => {
        const row = await db.tournamentEntry.findFirst({
          where: { categoryId, teamId },
          ...UNIQUE_LOOKUP,
        });
        return row ? toTournamentEntry(row) : undefined;
      });
    },
    async findCompetingTeamEntry(categoryId, playerId, excludedTeamId) {
      return translatePersistenceErrors(async () => {
        const row = await db.tournamentEntry.findFirst({
          where: {
            categoryId,
            status: { in: ['PENDING', 'CONFIRMED'] },
            teamId: { not: excludedTeamId },
            team: { members: { some: { playerId } } },
          },
          ...UNIQUE_LOOKUP,
        });
        return row ? toTournamentEntry(row) : undefined;
      });
    },
    async listByCategory(categoryId: string) {
      return translatePersistenceErrors(async () => {
        const rows = await db.tournamentEntry.findMany({
          where: { categoryId },
          orderBy: { registeredAt: 'asc' },
        });
        return rows.map(toTournamentEntry);
      });
    },
    async listByTournament(tournamentId: string) {
      return translatePersistenceErrors(async () => {
        // One query through the category relation; no per-category fan-out.
        const rows = await db.tournamentEntry.findMany({
          where: { category: { tournamentId } },
          orderBy: { registeredAt: 'asc' },
        });
        return rows.map(toTournamentEntry);
      });
    },
    updateSeed(id: string, seed: number | null) {
      return translatePersistenceErrors(async () =>
        toTournamentEntry(await db.tournamentEntry.update({ where: { id }, data: { seed } })),
      );
    },
    updateStatus(id, status) {
      return translatePersistenceErrors(async () =>
        toTournamentEntry(await db.tournamentEntry.update({ where: { id }, data: { status } })),
      );
    },
  };
}

function createStageRepository(db: Db): TournamentStageRepository {
  return {
    create(data: CreateStageData) {
      const { knockoutRules, ...rest } = data;
      return translatePersistenceErrors(async () =>
        toTournamentStage(
          await db.tournamentStage.create({
            data: { ...rest, knockoutRules: toNullableJson(knockoutRules ?? null) },
          }),
        ),
      );
    },
    async findById(id: string) {
      return translatePersistenceErrors(async () => {
        const row = await db.tournamentStage.findUnique({ where: { id } });
        return row ? toTournamentStage(row) : undefined;
      });
    },
    async listByCategory(categoryId: string) {
      return translatePersistenceErrors(async () => {
        const rows = await db.tournamentStage.findMany({
          where: { categoryId },
          orderBy: { sequence: 'asc' },
        });
        return rows.map(toTournamentStage);
      });
    },
    async listByTournament(tournamentId: string) {
      return translatePersistenceErrors(async () => {
        // One query through the category relation, ordered by category then stage.
        const rows = await db.tournamentStage.findMany({
          where: { category: { tournamentId } },
          orderBy: [{ categoryId: 'asc' }, { sequence: 'asc' }],
        });
        return rows.map(toTournamentStage);
      });
    },
    update(id: string, data: UpdateStageData) {
      const { knockoutRules, ...rest } = data;
      return translatePersistenceErrors(async () =>
        toTournamentStage(
          await db.tournamentStage.update({
            where: { id },
            data: {
              ...rest,
              ...(knockoutRules !== undefined
                ? { knockoutRules: toNullableJson(knockoutRules) }
                : {}),
            },
          }),
        ),
      );
    },
    updateStatus(id, status) {
      return translatePersistenceErrors(async () =>
        toTournamentStage(await db.tournamentStage.update({ where: { id }, data: { status } })),
      );
    },
  };
}

/**
 * Encodes a nullable JSON column value.
 *
 * `null` becomes SQL NULL (`Prisma.DbNull`) rather than JSON `null`, so a
 * cleared catalogue round-trips as "no rules" and the domain falls back to its
 * defaults. A present value is passed through as JSONB.
 */
function toNullableJson(
  value: Readonly<Record<string, unknown>> | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null ? Prisma.DbNull : (value as unknown as Prisma.InputJsonValue);
}

function createMatchRepository(db: Db): MatchRepository {
  return {
    create(data: CreateMatchData) {
      return translatePersistenceErrors(async () => toMatch(await db.match.create({ data })));
    },
    async findById(id: string) {
      return translatePersistenceErrors(async () => {
        const row = await db.match.findUnique({ where: { id } });
        return row ? toMatch(row) : undefined;
      });
    },
    async listByStage(stageId: string) {
      return translatePersistenceErrors(async () => {
        const rows = await db.match.findMany({
          where: { stageId },
          orderBy: { sequence: 'asc' },
        });
        return rows.map(toMatch);
      });
    },
    async createMany(data: readonly CreateMatchData[]) {
      return translatePersistenceErrors(async () => {
        // One insert for the whole generated set, so a fixture generation is a
        // single statement inside the unit of work rather than one round trip
        // per match. `createManyAndReturn` yields the created rows in one call.
        if (data.length === 0) {
          return [];
        }
        const rows = await db.match.createManyAndReturn({
          data: data.map((match) => ({ ...match })),
        });
        return rows.map(toMatch);
      });
    },
    async listCompletedByStage(stageId: string) {
      return translatePersistenceErrors(async () => {
        const rows = await db.match.findMany({
          where: { status: 'COMPLETED', stageId },
          orderBy: { sequence: 'asc' },
        });
        return rows.map(toMatch);
      });
    },
    async listByStageWithParticipants(stageId: string) {
      return translatePersistenceErrors(async () => {
        // One query with an include: participants arrive nested, so a bracket
        // read never issues a query per match.
        const rows = await db.match.findMany({
          where: { stageId },
          orderBy: { sequence: 'asc' },
          include: { participants: { orderBy: { slot: 'asc' } } },
        });
        return rows.map((row) => ({
          match: toMatch(row),
          participants: row.participants.map(toMatchParticipant),
        }));
      });
    },
    update(id: string, data: UpdateMatchData) {
      return translatePersistenceErrors(async () =>
        toMatch(await db.match.update({ where: { id }, data })),
      );
    },
    updateStatus(id, status) {
      return translatePersistenceErrors(async () =>
        toMatch(await db.match.update({ where: { id }, data: { status } })),
      );
    },
    complete(id: string, winnerEntryId: string) {
      return translatePersistenceErrors(async () =>
        toMatch(
          await db.match.update({
            where: { id },
            data: { status: 'COMPLETED', winnerEntryId },
          }),
        ),
      );
    },
    clearResult(id: string) {
      // The reverse of `complete`: the derived winner is cleared and the match
      // returns to IN_PROGRESS so the corrected games can be recorded. The
      // caller removes the stale games in the same transaction.
      return translatePersistenceErrors(async () =>
        toMatch(
          await db.match.update({
            where: { id },
            data: { status: 'IN_PROGRESS', winnerEntryId: null },
          }),
        ),
      );
    },
    schedule(id: string, data: MatchScheduleData) {
      // Writes court and both times in one update; the CHECK constraints and the
      // GiST exclusion constraint reject a partial or overlapping schedule.
      return translatePersistenceErrors(async () =>
        toMatch(
          await db.match.update({
            where: { id },
            data: {
              courtId: data.courtId,
              scheduledStartAt: data.scheduledStartAt,
              scheduledEndAt: data.scheduledEndAt,
            },
          }),
        ),
      );
    },
    unschedule(id: string) {
      return translatePersistenceErrors(async () =>
        toMatch(
          await db.match.update({
            where: { id },
            data: { courtId: null, scheduledStartAt: null, scheduledEndAt: null },
          }),
        ),
      );
    },
    async listByTournament(tournamentId: string) {
      return translatePersistenceErrors(async () => {
        // One query joining match → stage → category; no per-stage fan-out.
        const rows = await db.match.findMany({
          where: { stage: { category: { tournamentId } } },
          orderBy: { sequence: 'asc' },
        });
        return rows.map(toMatch);
      });
    },
    async findOverlappingSchedule(courtId, startAt, endAt, excludeMatchId) {
      return translatePersistenceErrors(async () => {
        const row = await db.match.findFirst({
          where: {
            courtId,
            ...(excludeMatchId ? { id: { not: excludeMatchId } } : {}),
            scheduledStartAt: { lt: endAt },
            scheduledEndAt: { gt: startAt },
          },
          ...UNIQUE_LOOKUP,
        });
        return row ? toMatch(row) : undefined;
      });
    },
    async listByCourt(courtId: string) {
      return translatePersistenceErrors(async () => {
        const rows = await db.match.findMany({
          where: { courtId },
          orderBy: { scheduledStartAt: 'asc' },
        });
        return rows.map(toMatch);
      });
    },
  };
}

function createCourtRepository(db: Db): CourtRepository {
  return {
    create(data: CreateCourtData) {
      return translatePersistenceErrors(async () => toCourt(await db.court.create({ data })));
    },
    async findById(id: string) {
      return translatePersistenceErrors(async () => {
        const row = await db.court.findUnique({ where: { id } });
        return row ? toCourt(row) : undefined;
      });
    },
    async listByTournament(tournamentId: string) {
      return translatePersistenceErrors(async () => {
        const rows = await db.court.findMany({
          where: { tournamentId },
          orderBy: { number: 'asc' },
        });
        return rows.map(toCourt);
      });
    },
    update(id: string, data: UpdateCourtData) {
      return translatePersistenceErrors(async () =>
        toCourt(await db.court.update({ where: { id }, data })),
      );
    },
    updateStatus(id, status) {
      return translatePersistenceErrors(async () =>
        toCourt(await db.court.update({ where: { id }, data: { status } })),
      );
    },
  };
}

function createMatchGameRepository(db: Db): MatchGameRepository {
  return {
    async createMany(data: readonly CreateMatchGameData[]) {
      return translatePersistenceErrors(async () => {
        // `createManyAndReturn` writes the whole result set in one statement
        // inside the active transaction, so a failure rolls back every game.
        const rows = await db.matchGame.createManyAndReturn({ data: [...data] });
        return rows.map(toMatchGame);
      });
    },
    async deleteByMatch(matchId: string) {
      return translatePersistenceErrors(async () => {
        // Removes the whole stored result of one match; the caller replaces it
        // in the same transaction, so a correction never leaves a mix of old
        // and new games.
        await db.matchGame.deleteMany({ where: { matchId } });
      });
    },
    async listByMatch(matchId: string) {
      return translatePersistenceErrors(async () => {
        const rows = await db.matchGame.findMany({
          where: { matchId },
          orderBy: { gameNumber: 'asc' },
        });
        return rows.map(toMatchGame);
      });
    },
    async listByMatchIds(matchIds: readonly string[]) {
      if (matchIds.length === 0) {
        return [];
      }
      return translatePersistenceErrors(async () => {
        const rows = await db.matchGame.findMany({
          where: { matchId: { in: [...matchIds] } },
          orderBy: [{ matchId: 'asc' }, { gameNumber: 'asc' }],
        });
        return rows.map((row) => ({ matchId: row.matchId, ...toMatchGame(row) }));
      });
    },
  };
}

function createMatchParticipantRepository(db: Db): MatchParticipantRepository {
  return {
    create(data: CreateMatchParticipantData) {
      return translatePersistenceErrors(async () =>
        toMatchParticipant(await db.matchParticipant.create({ data })),
      );
    },
    async createMany(data: readonly CreateMatchParticipantData[]) {
      if (data.length === 0) {
        return [];
      }
      return translatePersistenceErrors(async () => {
        const rows = await db.matchParticipant.createManyAndReturn({
          data: data.map((participant) => ({ ...participant })),
        });
        return rows.map(toMatchParticipant);
      });
    },
    async listByMatch(matchId: string) {
      return translatePersistenceErrors(async () => {
        const rows = await db.matchParticipant.findMany({
          where: { matchId },
          orderBy: { slot: 'asc' },
        });
        return rows.map(toMatchParticipant);
      });
    },
    async listByMatchIds(matchIds: readonly string[]) {
      if (matchIds.length === 0) {
        return [];
      }
      return translatePersistenceErrors(async () => {
        const rows = await db.matchParticipant.findMany({
          where: { matchId: { in: [...matchIds] } },
          orderBy: [{ matchId: 'asc' }, { slot: 'asc' }],
        });
        return rows.map(toMatchParticipant);
      });
    },
    async findSlot(matchId: string, slot: number) {
      return translatePersistenceErrors(async () => {
        const row = await db.matchParticipant.findUnique({
          where: { matchId_slot: { matchId, slot } },
        });
        return row ? toMatchParticipant(row) : undefined;
      });
    },
    async findEntry(matchId: string, entryId: string) {
      return translatePersistenceErrors(async () => {
        const row = await db.matchParticipant.findUnique({
          where: { matchId_entryId: { matchId, entryId } },
        });
        return row ? toMatchParticipant(row) : undefined;
      });
    },
    async fillSlot(matchId, slot, entryId) {
      // Create-only: the compound unique index on (matchId, slot) is the final
      // guard, so a race that fills the slot first surfaces as a ConflictError
      // instead of overwriting the winner already there.
      return translatePersistenceErrors(async () =>
        toMatchParticipant(await db.matchParticipant.create({ data: { matchId, slot, entryId } })),
      );
    },
    async clearSlot(matchId, slot) {
      // Empties a slot so a corrected bracket can re-fill it. `deleteMany` is a
      // no-op when the slot is already empty, so re-derivation stays idempotent.
      return translatePersistenceErrors(async () => {
        await db.matchParticipant.deleteMany({ where: { matchId, slot } });
      });
    },
  };
}

function createRealtimeEventRepository(db: Db): RealtimeEventRepository {
  return {
    create(data: CreateRealtimeEventData) {
      // `payload` is a JSON column; an absent payload is stored as an empty
      // object so the domain (which treats empty as "no payload") round-trips.
      return translatePersistenceErrors(async () =>
        toRealtimeEvent(
          await db.realtimeEvent.create({
            data: {
              tournamentId: data.tournamentId,
              eventType: data.eventType,
              aggregateType: data.aggregateType,
              aggregateId: data.aggregateId,
              payload: (data.payload ?? {}) as Prisma.InputJsonValue,
            },
          }),
        ),
      );
    },
    async getPendingEvents(limit: number) {
      return translatePersistenceErrors(async () => {
        // Oldest first, so a dispatcher restart drains in the order events were
        // committed. Only unpublished rows are eligible.
        const rows = await db.realtimeEvent.findMany({
          where: { publishedAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: limit,
        });
        return rows.map(toRealtimeEvent);
      });
    },
    markPublished(id: string) {
      return translatePersistenceErrors(async () => {
        // Conditional update: a concurrent drain that already stamped the row
        // matches nothing instead of overwriting the original publish time.
        await db.realtimeEvent.updateMany({
          where: { id, publishedAt: null },
          data: { publishedAt: new Date() },
        });
      });
    },
  };
}

/** Builds a client's repositories from an already-open database handle. */
export function createRepositoryClient(db: Db): RepositoryClient {
  return {
    tournaments: createTournamentRepository(db),
    categories: createCategoryRepository(db),
    players: createPlayerRepository(db),
    teams: createTeamRepository(db),
    teamMembers: createTeamMemberRepository(db),
    entries: createEntryRepository(db),
    stages: createStageRepository(db),
    matches: createMatchRepository(db),
    matchParticipants: createMatchParticipantRepository(db),
    matchGames: createMatchGameRepository(db),
    courts: createCourtRepository(db),
    realtimeEvents: createRealtimeEventRepository(db),
  };
}

/**
 * Adapts a `PrismaClient` to the application's `UnitOfWork`.
 *
 * `runInTransaction` opens one interactive transaction, binds a repository
 * client to it and passes that client to `work`. An error thrown from `work`
 * rolls the transaction back; an application error propagates unchanged so the
 * service's own typed failure survives.
 */
export function createPrismaUnitOfWork(prisma: PrismaClient): UnitOfWork {
  return {
    async runInTransaction<T>(work: (client: RepositoryClient) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => work(createRepositoryClient(tx)));
    },
  };
}
