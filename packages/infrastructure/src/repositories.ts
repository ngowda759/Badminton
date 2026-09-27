import type {
  CreateCategoryData,
  CreateEntryData,
  CreateMatchData,
  CreateMatchGameData,
  CreateMatchParticipantData,
  CreatePlayerData,
  CreateStageData,
  CreateTeamData,
  CreateTeamMemberData,
  CreateTournamentData,
  MatchGameRepository,
  MatchParticipantRepository,
  MatchRepository,
  PlayerRepository,
  RepositoryClient,
  TeamMemberRepository,
  TeamRepository,
  TournamentCategoryRepository,
  TournamentEntryRepository,
  TournamentRepository,
  TournamentStageRepository,
  UnitOfWork,
  UpdateCategoryData,
  UpdateMatchData,
  UpdatePlayerData,
  UpdateStageData,
  UpdateTeamData,
  UpdateTournamentData,
} from '@badminton/application';
import type { PrismaClient, TransactionClient } from '@badminton/database';

import { translatePersistenceErrors } from './errors.ts';
import {
  toMatch,
  toMatchGame,
  toMatchParticipant,
  toPlayer,
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
    update(id: string, data: UpdateTeamData) {
      return translatePersistenceErrors(async () =>
        toTeam(await db.team.update({ where: { id }, data })),
      );
    },
  };
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
      return translatePersistenceErrors(async () =>
        toTournamentStage(await db.tournamentStage.create({ data })),
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
    update(id: string, data: UpdateStageData) {
      return translatePersistenceErrors(async () =>
        toTournamentStage(await db.tournamentStage.update({ where: { id }, data })),
      );
    },
    updateStatus(id, status) {
      return translatePersistenceErrors(async () =>
        toTournamentStage(await db.tournamentStage.update({ where: { id }, data: { status } })),
      );
    },
  };
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
    async listCompletedByStage(stageId: string) {
      return translatePersistenceErrors(async () => {
        const rows = await db.match.findMany({
          where: { status: 'COMPLETED', stageId },
          orderBy: { sequence: 'asc' },
        });
        return rows.map(toMatch);
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
