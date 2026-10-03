/* eslint-disable @typescript-eslint/require-await -- the fake ports implement
   async signatures over synchronous in-memory maps; there is nothing to await. */
import { createHash } from 'node:crypto';

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
import {
  ConflictError,
  type CategoryStatus,
  type Court,
  type CourtStatus,
  type EntryStatus,
  type Match,
  type MatchGame,
  type MatchParticipant,
  type MatchSlot,
  type MatchStatus,
  type Player,
  type RealtimeEvent,
  type StageStatus,
  type Team,
  type TeamMember,
  type Tournament,
  type TournamentCategory,
  type TournamentEntry,
  type TournamentStage,
} from '@badminton/domain';

/**
 * In-memory fake repository client for pure application-service unit tests.
 *
 * It is a real, deterministic implementation of the ports (not a spy): it
 * enforces the same uniqueness rules the database does so service behaviour can
 * be exercised without PostgreSQL. Transaction rollback is simulated by
 * snapshotting state at `runInTransaction` and restoring it when `work` throws.
 */

interface State {
  tournaments: Map<string, Tournament>;
  categories: Map<string, TournamentCategory>;
  players: Map<string, Player>;
  teams: Map<string, Team>;
  teamMembers: Map<string, TeamMember>;
  entries: Map<string, TournamentEntry>;
  stages: Map<string, TournamentStage>;
  matches: Map<string, Match>;
  matchParticipants: Map<string, MatchParticipant>;
  matchGames: Map<string, FakeMatchGame>;
  courts: Map<string, Court>;
  realtimeEvents: Map<string, RealtimeEvent>;
}

/** A stored game; the domain `MatchGame` has no owner field, so the fake adds one. */
interface FakeMatchGame extends MatchGame {
  readonly matchId: string;
}

let sequence = 0;

/**
 * Deterministic UUID for a fake row.
 *
 * Real UUIDs - not readable strings - so that service-level behaviour matches
 * production: the API route tests validate an `:id` path parameter as a UUID
 * before calling a service, and the service must then find the same row. The
 * value is derived from a counter through SHA-1 and shaped into a valid
 * UUIDv5, so it is stable for a given creation order within a test.
 */
function nextId(prefix: string): string {
  sequence += 1;
  const digest = createHash('sha1').update(`${prefix}:${sequence}`).digest('hex');
  const variant = ((Number.parseInt(digest[16] as string, 16) & 0x3) | 0x8).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-');
}

function now(): Date {
  return new Date('2026-01-01T00:00:00.000Z');
}

/**
 * Applies cursor pagination to an already-ordered list of fake rows.
 *
 * Mirrors the production contract exactly: the cursor is the last id of the
 * returned page, the page is capped at `query.limit`, and `nextCursor` is the
 * last returned id when more rows remain (or `null` on the last page). Ordering
 * is the caller's responsibility - it must match the real repository's ordering.
 */
function paginate<T extends { readonly id: string }>(
  rows: readonly T[],
  query: ListQuery,
): ListPage<T> {
  const start = query.cursor ? rows.findIndex((row) => row.id === query.cursor) + 1 : 0;
  const items = rows.slice(start, start + query.limit);
  const last = items[items.length - 1];
  const hasMore = rows.length > start + query.limit;
  return { items, nextCursor: hasMore && last ? last.id : null };
}

/**
 * A unique-key violation surfaced the way the real adapter would: as an
 * application `ConflictError` with a safe, human-readable message. Constraint
 * names mirror the PostgreSQL index names the adapter recognises.
 */
const FAKE_CONFLICT_MESSAGES: Readonly<Record<string, string>> = {
  tournaments_active_name_key: 'A live tournament with this name already exists.',
  tournament_categories_tournamentId_code_key:
    'A category with this code already exists in this tournament.',
  tournament_categories_name_key: 'A category with this name already exists in this tournament.',
  players_email_key: 'A player with this email address already exists.',
  players_phone_key: 'A player with this phone number already exists.',
  team_members_teamId_playerId_key: 'This player is already a member of the team.',
  entries_category_player_key: 'This player is already registered in this category.',
  entries_category_team_key: 'This team is already registered in this category.',
  tournament_stages_categoryId_sequence_key:
    'Another stage already occupies this sequence in this category.',
  matches_stageId_sequence_key: 'Another match already occupies this sequence in this stage.',
  match_participants_matchId_slot_key: 'This slot is already occupied in this match.',
  match_participants_matchId_entryId_key: 'This entry is already a participant in this match.',
  match_games_matchId_gameNumber_key: 'A result for this match has already been recorded.',
  courts_tournamentId_number_key: 'A court with this number already exists in this tournament.',
  matches_court_schedule_no_overlap: 'This court already has a match overlapping that time.',
};

function assertUnique(condition: boolean, constraint: string): void {
  if (!condition) {
    throw new ConflictError(FAKE_CONFLICT_MESSAGES[constraint] ?? 'A conflict occurred.');
  }
}

function emptyState(): State {
  return {
    tournaments: new Map(),
    categories: new Map(),
    players: new Map(),
    teams: new Map(),
    teamMembers: new Map(),
    entries: new Map(),
    stages: new Map(),
    matches: new Map(),
    matchParticipants: new Map(),
    matchGames: new Map(),
    courts: new Map(),
    realtimeEvents: new Map(),
  };
}

function cloneState(state: State): State {
  return {
    tournaments: new Map(state.tournaments),
    categories: new Map(state.categories),
    players: new Map(state.players),
    teams: new Map(state.teams),
    teamMembers: new Map(state.teamMembers),
    entries: new Map(state.entries),
    stages: new Map(state.stages),
    matches: new Map(state.matches),
    matchParticipants: new Map(state.matchParticipants),
    matchGames: new Map(state.matchGames),
    courts: new Map(state.courts),
    realtimeEvents: new Map(state.realtimeEvents),
  };
}

/**
 * Copies `snapshot` back into the live `state` maps **in place**.
 *
 * The repository closures capture the `state` object, so rollback must mutate
 * its maps rather than replace the object.
 */
function restoreState(state: State, snapshot: State): void {
  for (const key of Object.keys(state) as (keyof State)[]) {
    const live = state[key] as Map<string, unknown>;
    const saved = snapshot[key] as Map<string, unknown>;
    live.clear();
    for (const [id, row] of saved) {
      live.set(id, row);
    }
  }
}

function buildClient(state: State): RepositoryClient {
  const tournaments: TournamentRepository = {
    async create(data: CreateTournamentData): Promise<Tournament> {
      for (const row of state.tournaments.values()) {
        const active = row.status !== 'COMPLETED' && row.status !== 'CANCELLED';
        if (active && row.name.toLowerCase() === data.name.toLowerCase()) {
          assertUnique(false, 'tournaments_active_name_key');
        }
      }
      const row: Tournament = {
        id: nextId('tournament'),
        ...data,
        createdAt: now(),
        updatedAt: now(),
      };
      state.tournaments.set(row.id, row);
      return row;
    },
    async findById(id) {
      return state.tournaments.get(id);
    },
    async listPage(query) {
      // Newest first: all fake rows share one timestamp, so the id tiebreaker
      // (descending) provides the deterministic order.
      const ordered = [...state.tournaments.values()].sort((left, right) =>
        right.id.localeCompare(left.id),
      );
      return paginate(ordered, query);
    },
    async update(id: string, data: UpdateTournamentData): Promise<Tournament> {
      const current = state.tournaments.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated: Tournament = {
        ...current,
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
        ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
        ...(data.location !== undefined ? { location: data.location } : {}),
        updatedAt: now(),
      };
      state.tournaments.set(id, updated);
      return updated;
    },
    async updateStatus(id, status) {
      const current = state.tournaments.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated = { ...current, status, updatedAt: now() };
      state.tournaments.set(id, updated);
      return updated;
    },
  };

  const categories: TournamentCategoryRepository = {
    async create(data: CreateCategoryData): Promise<TournamentCategory> {
      for (const row of state.categories.values()) {
        if (row.tournamentId === data.tournamentId && row.code === data.code) {
          assertUnique(false, 'tournament_categories_tournamentId_code_key');
        }
        if (
          row.tournamentId === data.tournamentId &&
          row.name.toLowerCase() === data.name.toLowerCase()
        ) {
          assertUnique(false, 'tournament_categories_name_key');
        }
      }
      const row: TournamentCategory = {
        id: nextId('category'),
        ...data,
        createdAt: now(),
        updatedAt: now(),
      };
      state.categories.set(row.id, row);
      return row;
    },
    async findById(id) {
      return state.categories.get(id);
    },
    async listByTournament(tournamentId) {
      return [...state.categories.values()].filter((row) => row.tournamentId === tournamentId);
    },
    async update(id: string, data: UpdateCategoryData): Promise<TournamentCategory> {
      const current = state.categories.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated = { ...current, ...data, updatedAt: now() };
      state.categories.set(id, updated);
      return updated;
    },
    async updateStatus(id, status: CategoryStatus) {
      const current = state.categories.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated = { ...current, status, updatedAt: now() };
      state.categories.set(id, updated);
      return updated;
    },
    async countEntries(categoryId) {
      return [...state.entries.values()].filter((row) => row.categoryId === categoryId).length;
    },
  };

  const players: PlayerRepository = {
    async create(data: CreatePlayerData): Promise<Player> {
      if (data.email !== null) {
        for (const row of state.players.values()) {
          if (row.email !== null && row.email.toLowerCase() === data.email.toLowerCase()) {
            assertUnique(false, 'players_email_key');
          }
        }
      }
      if (data.phone !== null) {
        assertUnique(
          ![...state.players.values()].some((row) => row.phone === data.phone),
          'players_phone_key',
        );
      }
      const row: Player = { id: nextId('player'), ...data, createdAt: now(), updatedAt: now() };
      state.players.set(row.id, row);
      return row;
    },
    async findById(id) {
      return state.players.get(id);
    },
    async findByEmail(email) {
      return [...state.players.values()].find(
        (row) => row.email !== null && row.email.toLowerCase() === email.toLowerCase(),
      );
    },
    async findByPhone(phone) {
      return [...state.players.values()].find((row) => row.phone === phone);
    },
    async listPage(query) {
      // Fake rows share one createdAt, so the id tiebreaker (descending) gives
      // the deterministic order, matching the adapter's (createdAt, id) sort.
      const ordered = [...state.players.values()].sort((left, right) =>
        right.id.localeCompare(left.id),
      );
      return paginate(ordered, query);
    },
    async listByIds(ids) {
      const wanted = new Set(ids);
      return [...state.players.values()].filter((row) => wanted.has(row.id));
    },
    async update(id: string, data: UpdatePlayerData): Promise<Player> {
      const current = state.players.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated = { ...current, ...data, updatedAt: now() };
      state.players.set(id, updated);
      return updated;
    },
  };

  const teams: TeamRepository = {
    async create(data: CreateTeamData): Promise<Team> {
      const row: Team = { id: nextId('team'), ...data, createdAt: now(), updatedAt: now() };
      state.teams.set(row.id, row);
      return row;
    },
    async findById(id) {
      return state.teams.get(id);
    },
    async listPageWithMemberCount(query) {
      const ordered = [...state.teams.values()].sort((left, right) =>
        right.id.localeCompare(left.id),
      );
      const page = paginate(ordered, query);
      const items: TeamWithMemberCount[] = page.items.map((team) => ({
        team,
        memberCount: [...state.teamMembers.values()].filter((row) => row.teamId === team.id).length,
      }));
      return { items, nextCursor: page.nextCursor };
    },
    async listByIds(ids) {
      const wanted = new Set(ids);
      return [...state.teams.values()].filter((row) => wanted.has(row.id));
    },
    async update(id: string, data: UpdateTeamData): Promise<Team> {
      const current = state.teams.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated = { ...current, ...data, updatedAt: now() };
      state.teams.set(id, updated);
      return updated;
    },
  };

  const teamMembers: TeamMemberRepository = {
    async create(data: CreateTeamMemberData): Promise<TeamMember> {
      for (const row of state.teamMembers.values()) {
        if (row.teamId === data.teamId && row.playerId === data.playerId) {
          assertUnique(false, 'team_members_teamId_playerId_key');
        }
      }
      const row: TeamMember = { id: nextId('member'), ...data, createdAt: now(), updatedAt: now() };
      state.teamMembers.set(row.id, row);
      return row;
    },
    async listByTeam(teamId) {
      return [...state.teamMembers.values()]
        .filter((row) => row.teamId === teamId)
        .sort((a, b) => a.position - b.position);
    },
    async findMembership(teamId, playerId) {
      return [...state.teamMembers.values()].find(
        (row) => row.teamId === teamId && row.playerId === playerId,
      );
    },
    async remove(teamId, playerId) {
      for (const [id, row] of state.teamMembers) {
        if (row.teamId === teamId && row.playerId === playerId) {
          state.teamMembers.delete(id);
        }
      }
    },
  };

  const entries: TournamentEntryRepository = {
    async create(data: CreateEntryData): Promise<TournamentEntry> {
      if (data.playerId !== null) {
        assertUnique(
          ![...state.entries.values()].some(
            (row) => row.categoryId === data.categoryId && row.playerId === data.playerId,
          ),
          'entries_category_player_key',
        );
      }
      if (data.teamId !== null) {
        assertUnique(
          ![...state.entries.values()].some(
            (row) => row.categoryId === data.categoryId && row.teamId === data.teamId,
          ),
          'entries_category_team_key',
        );
      }
      const row: TournamentEntry = {
        id: nextId('entry'),
        ...data,
        registeredAt: now(),
        createdAt: now(),
        updatedAt: now(),
      };
      state.entries.set(row.id, row);
      return row;
    },
    async findById(id) {
      return state.entries.get(id);
    },
    async findByCategoryAndPlayer(categoryId, playerId) {
      return [...state.entries.values()].find(
        (row) => row.categoryId === categoryId && row.playerId === playerId,
      );
    },
    async findByCategoryAndTeam(categoryId, teamId) {
      return [...state.entries.values()].find(
        (row) => row.categoryId === categoryId && row.teamId === teamId,
      );
    },
    async findCompetingTeamEntry(categoryId, playerId, excludedTeamId) {
      const teamIds = new Set(
        [...state.teamMembers.values()]
          .filter((member) => member.playerId === playerId)
          .map((member) => member.teamId),
      );
      teamIds.delete(excludedTeamId);
      return [...state.entries.values()].find(
        (row) =>
          row.categoryId === categoryId &&
          row.teamId !== null &&
          teamIds.has(row.teamId) &&
          (row.status === 'PENDING' || row.status === 'CONFIRMED'),
      );
    },
    async listByCategory(categoryId) {
      return [...state.entries.values()].filter((row) => row.categoryId === categoryId);
    },
    async listByTournament(tournamentId) {
      const categoryIds = new Set(
        [...state.categories.values()]
          .filter((row) => row.tournamentId === tournamentId)
          .map((row) => row.id),
      );
      return [...state.entries.values()].filter((row) => categoryIds.has(row.categoryId));
    },
    async updateSeed(id, seed) {
      const current = state.entries.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated = { ...current, seed, updatedAt: now() };
      state.entries.set(id, updated);
      return updated;
    },
    async updateStatus(id, status: EntryStatus) {
      const current = state.entries.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated = { ...current, status, updatedAt: now() };
      state.entries.set(id, updated);
      return updated;
    },
  };

  const stages: TournamentStageRepository = {
    async create(data: CreateStageData): Promise<TournamentStage> {
      assertUnique(
        ![...state.stages.values()].some(
          (row) => row.categoryId === data.categoryId && row.sequence === data.sequence,
        ),
        'tournament_stages_categoryId_sequence_key',
      );
      const row: TournamentStage = {
        id: nextId('stage'),
        ...data,
        knockoutRules: data.knockoutRules ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.stages.set(row.id, row);
      return row;
    },
    async findById(id) {
      return state.stages.get(id);
    },
    async listByCategory(categoryId) {
      return [...state.stages.values()].filter((row) => row.categoryId === categoryId);
    },
    async listByTournament(tournamentId) {
      const categoryIds = new Set(
        [...state.categories.values()]
          .filter((row) => row.tournamentId === tournamentId)
          .map((row) => row.id),
      );
      return [...state.stages.values()].filter((row) => categoryIds.has(row.categoryId));
    },
    async update(id: string, data: UpdateStageData): Promise<TournamentStage> {
      const current = state.stages.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated = { ...current, ...data, updatedAt: now() };
      state.stages.set(id, updated);
      return updated;
    },
    async updateStatus(id, status: StageStatus) {
      const current = state.stages.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated = { ...current, status, updatedAt: now() };
      state.stages.set(id, updated);
      return updated;
    },
    async remove(id: string): Promise<void> {
      // Mirrors the `matches.stageId` Restrict FK: a stage that still has a
      // match cannot be deleted, and the adapter surfaces that as a conflict.
      assertUnique(
        ![...state.matches.values()].some((row) => row.stageId === id),
        'matches_stageId_fkey',
      );
      state.stages.delete(id);
    },
  };

  const matches: MatchRepository = {
    async create(data: CreateMatchData): Promise<Match> {
      assertUnique(
        ![...state.matches.values()].some(
          (row) => row.stageId === data.stageId && row.sequence === data.sequence,
        ),
        'matches_stageId_sequence_key',
      );
      const row: Match = {
        id: nextId('match'),
        ...data,
        winnerEntryId: null,
        knockoutFormat: data.knockoutFormat ?? null,
        knockoutPointsPerGame: data.knockoutPointsPerGame ?? null,
        courtId: null,
        scheduledStartAt: null,
        scheduledEndAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.matches.set(row.id, row);
      return row;
    },
    async createMany(data: readonly CreateMatchData[]): Promise<readonly Match[]> {
      // Mirrors the adapter: one call inserts the whole set, but each row still
      // respects the stage-unique sequence rule.
      const created: Match[] = [];
      for (const entry of data) {
        created.push(await matches.create(entry));
      }
      return created;
    },
    async findById(id) {
      return state.matches.get(id);
    },
    async listByStage(stageId) {
      return [...state.matches.values()].filter((row) => row.stageId === stageId);
    },
    async listCompletedByStage(stageId) {
      return [...state.matches.values()].filter(
        (row) => row.status === 'COMPLETED' && row.stageId === stageId,
      );
    },
    async listByStageWithParticipants(stageId) {
      return [...state.matches.values()]
        .filter((row) => row.stageId === stageId)
        .sort((left, right) => left.sequence - right.sequence)
        .map((match) => ({
          match,
          participants: [...state.matchParticipants.values()]
            .filter((participant) => participant.matchId === match.id)
            .sort((left, right) => left.slot - right.slot),
        }));
    },
    async update(id: string, data: UpdateMatchData): Promise<Match> {
      const current = state.matches.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated = { ...current, ...data, updatedAt: now() };
      state.matches.set(id, updated);
      return updated;
    },
    async updateStatus(id, status: MatchStatus) {
      const current = state.matches.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated = { ...current, status, updatedAt: now() };
      state.matches.set(id, updated);
      return updated;
    },
    async complete(id: string, winnerEntryId: string) {
      const current = state.matches.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated: Match = {
        ...current,
        status: 'COMPLETED',
        winnerEntryId,
        updatedAt: now(),
      };
      state.matches.set(id, updated);
      return updated;
    },
    async clearResult(id: string) {
      const current = state.matches.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated: Match = {
        ...current,
        status: 'IN_PROGRESS',
        winnerEntryId: null,
        updatedAt: now(),
      };
      state.matches.set(id, updated);
      return updated;
    },
    async schedule(id: string, data: MatchScheduleData) {
      const current = state.matches.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      // Mirrors the PostgreSQL exclusion constraint: a court cannot hold two
      // matches whose windows overlap. Keeps the fake a faithful boundary.
      const overlaps = [...state.matches.values()].some(
        (row) =>
          row.id !== id &&
          row.courtId === data.courtId &&
          row.scheduledStartAt !== null &&
          row.scheduledEndAt !== null &&
          row.scheduledStartAt.getTime() < data.scheduledEndAt.getTime() &&
          data.scheduledStartAt.getTime() < row.scheduledEndAt.getTime(),
      );
      assertUnique(!overlaps, 'matches_court_schedule_no_overlap');

      const updated: Match = {
        ...current,
        courtId: data.courtId,
        scheduledStartAt: data.scheduledStartAt,
        scheduledEndAt: data.scheduledEndAt,
        updatedAt: now(),
      };
      state.matches.set(id, updated);
      return updated;
    },
    async unschedule(id: string) {
      const current = state.matches.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated: Match = {
        ...current,
        courtId: null,
        scheduledStartAt: null,
        scheduledEndAt: null,
        updatedAt: now(),
      };
      state.matches.set(id, updated);
      return updated;
    },
    async listByTournament(tournamentId) {
      const categoryIds = new Set(
        [...state.categories.values()]
          .filter((row) => row.tournamentId === tournamentId)
          .map((row) => row.id),
      );
      const stageIds = new Set(
        [...state.stages.values()]
          .filter((row) => categoryIds.has(row.categoryId))
          .map((row) => row.id),
      );
      return [...state.matches.values()].filter((row) => stageIds.has(row.stageId));
    },
    async findOverlappingSchedule(courtId, startAt, endAt, excludeMatchId) {
      return [...state.matches.values()].find(
        (row) =>
          row.courtId === courtId &&
          row.id !== excludeMatchId &&
          row.scheduledStartAt !== null &&
          row.scheduledEndAt !== null &&
          row.scheduledStartAt.getTime() < endAt.getTime() &&
          startAt.getTime() < row.scheduledEndAt.getTime(),
      );
    },
    async listByCourt(courtId) {
      return [...state.matches.values()].filter((row) => row.courtId === courtId);
    },
  };

  const matchGames: MatchGameRepository = {
    async createMany(data: readonly CreateMatchGameData[]): Promise<readonly MatchGame[]> {
      const created: MatchGame[] = [];
      for (const game of data) {
        assertUnique(
          ![...state.matchGames.values()].some(
            (row) => row.matchId === game.matchId && row.gameNumber === game.gameNumber,
          ),
          'match_games_matchId_gameNumber_key',
        );
        const row: FakeMatchGame = {
          matchId: game.matchId,
          gameNumber: game.gameNumber,
          participant1Points: game.participant1Points,
          participant2Points: game.participant2Points,
          winnerSlot: game.winnerSlot,
        };
        state.matchGames.set(nextId('game'), row);
        created.push(toDomainGame(row));
      }
      return created;
    },
    async deleteByMatch(matchId) {
      for (const [id, row] of state.matchGames) {
        if (row.matchId === matchId) {
          state.matchGames.delete(id);
        }
      }
    },
    async listByMatch(matchId) {
      return [...state.matchGames.values()]
        .filter((row) => row.matchId === matchId)
        .sort((left, right) => left.gameNumber - right.gameNumber)
        .map(toDomainGame);
    },
    async listByMatchIds(matchIds) {
      const wanted = new Set(matchIds);
      return [...state.matchGames.values()]
        .filter((row) => wanted.has(row.matchId))
        .sort((left, right) => left.gameNumber - right.gameNumber)
        .map((row) => ({ matchId: row.matchId, ...toDomainGame(row) }));
    },
  };

  const matchParticipants: MatchParticipantRepository = {
    async create(data: CreateMatchParticipantData): Promise<MatchParticipant> {
      assertUnique(
        ![...state.matchParticipants.values()].some(
          (row) => row.matchId === data.matchId && row.slot === data.slot,
        ),
        'match_participants_matchId_slot_key',
      );
      assertUnique(
        ![...state.matchParticipants.values()].some(
          (row) => row.matchId === data.matchId && row.entryId === data.entryId,
        ),
        'match_participants_matchId_entryId_key',
      );
      const row: MatchParticipant = {
        id: nextId('participant'),
        ...data,
        createdAt: now(),
        updatedAt: now(),
      };
      state.matchParticipants.set(row.id, row);
      return row;
    },
    async createMany(
      data: readonly CreateMatchParticipantData[],
    ): Promise<readonly MatchParticipant[]> {
      const created: MatchParticipant[] = [];
      for (const entry of data) {
        created.push(await matchParticipants.create(entry));
      }
      return created;
    },
    async listByMatch(matchId) {
      return [...state.matchParticipants.values()].filter((row) => row.matchId === matchId);
    },
    async listByMatchIds(matchIds) {
      const wanted = new Set(matchIds);
      return [...state.matchParticipants.values()].filter((row) => wanted.has(row.matchId));
    },
    async findSlot(matchId, slot) {
      return [...state.matchParticipants.values()].find(
        (row) => row.matchId === matchId && row.slot === slot,
      );
    },
    async findEntry(matchId, entryId) {
      return [...state.matchParticipants.values()].find(
        (row) => row.matchId === matchId && row.entryId === entryId,
      );
    },
    async fillSlot(matchId, slot, entryId) {
      // Fill-only, mirroring the Prisma `create`: an occupied slot is a conflict
      // and the existing entry is never overwritten.
      assertUnique(
        ![...state.matchParticipants.values()].some(
          (row) => row.matchId === matchId && row.slot === slot,
        ),
        'match_participants_matchId_slot_key',
      );
      assertUnique(
        ![...state.matchParticipants.values()].some(
          (row) => row.matchId === matchId && row.entryId === entryId,
        ),
        'match_participants_matchId_entryId_key',
      );
      const created: MatchParticipant = {
        id: nextId('participant'),
        matchId,
        slot: slot === 2 ? 2 : 1,
        entryId,
        createdAt: now(),
        updatedAt: now(),
      };
      state.matchParticipants.set(created.id, created);
      return created;
    },
    async clearSlot(matchId, slot) {
      // Empties a slot, mirroring the adapter's `deleteMany`: a no-op when the
      // slot is already empty, so re-derivation is idempotent.
      for (const [id, row] of state.matchParticipants) {
        if (row.matchId === matchId && row.slot === slot) {
          state.matchParticipants.delete(id);
        }
      }
    },
  };

  const courts: CourtRepository = {
    async create(data: CreateCourtData): Promise<Court> {
      assertUnique(
        ![...state.courts.values()].some(
          (row) => row.tournamentId === data.tournamentId && row.number === data.number,
        ),
        'courts_tournamentId_number_key',
      );
      const row: Court = {
        id: nextId('court'),
        ...data,
        createdAt: now(),
        updatedAt: now(),
      };
      state.courts.set(row.id, row);
      return row;
    },
    async findById(id) {
      return state.courts.get(id);
    },
    async listByTournament(tournamentId) {
      return [...state.courts.values()]
        .filter((row) => row.tournamentId === tournamentId)
        .sort((left, right) => left.number - right.number);
    },
    async update(id: string, data: UpdateCourtData): Promise<Court> {
      const current = state.courts.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      if (data.number !== undefined) {
        assertUnique(
          ![...state.courts.values()].some(
            (row) =>
              row.tournamentId === current.tournamentId &&
              row.number === data.number &&
              row.id !== id,
          ),
          'courts_tournamentId_number_key',
        );
      }
      const updated: Court = { ...current, ...data, updatedAt: now() };
      state.courts.set(id, updated);
      return updated;
    },
    async updateStatus(id: string, status: CourtStatus) {
      const current = state.courts.get(id);
      if (!current) {
        throw new Error('record not found');
      }
      const updated: Court = { ...current, status, updatedAt: now() };
      state.courts.set(id, updated);
      return updated;
    },
    async remove(id: string): Promise<void> {
      // Mirrors the `matches.courtId` Restrict FK: a court that still has a
      // match cannot be deleted, and the adapter surfaces that as a conflict.
      assertUnique(
        ![...state.matches.values()].some((row) => row.courtId === id),
        'matches_courtId_fkey',
      );
      state.courts.delete(id);
    },
  };

  const realtimeEvents: RealtimeEventRepository = {
    async create(data: CreateRealtimeEventData): Promise<RealtimeEvent> {
      const row: RealtimeEvent = {
        id: nextId('event'),
        tournamentId: data.tournamentId,
        eventType: data.eventType,
        aggregateType: data.aggregateType,
        aggregateId: data.aggregateId,
        payload: data.payload ?? null,
        occurredAt: now(),
        publishedAt: null,
      };
      state.realtimeEvents.set(row.id, row);
      return row;
    },
    async getPendingEvents(limit) {
      return [...state.realtimeEvents.values()]
        .filter((row) => row.publishedAt === null)
        .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
        .slice(0, limit);
    },
    async markPublished(id) {
      const current = state.realtimeEvents.get(id);
      if (!current || current.publishedAt !== null) {
        return;
      }
      state.realtimeEvents.set(id, { ...current, publishedAt: now() });
    },
  };

  return {
    tournaments,
    categories,
    players,
    teams,
    teamMembers,
    entries,
    stages,
    matches,
    matchParticipants,
    matchGames,
    courts,
    realtimeEvents,
  };
}

function toDomainGame(row: FakeMatchGame): MatchGame {
  return {
    gameNumber: row.gameNumber,
    participant1Points: row.participant1Points,
    participant2Points: row.participant2Points,
    winnerSlot: row.winnerSlot,
  };
}

export interface FakeRepositories {
  readonly client: RepositoryClient;
  readonly unitOfWork: UnitOfWork;
  reset(): void;
}

/**
 * Creates the fake client and a `UnitOfWork` that snapshots all maps on
 * transaction start and restores them in place when `work` rejects, so services
 * that write more than once are still atomic in tests.
 */
export function createFakeRepositories(): FakeRepositories {
  const state = emptyState();
  const client = buildClient(state);

  return {
    client,
    unitOfWork: {
      async runInTransaction<T>(work: (tx: RepositoryClient) => Promise<T>): Promise<T> {
        const snapshot = cloneState(state);
        try {
          return await work(client);
        } catch (error) {
          restoreState(state, snapshot);
          throw error;
        }
      },
    },
    reset() {
      const fresh = emptyState();
      restoreState(state, fresh);
    },
  };
}

export const FAKE_MATCH_SLOTS = [1, 2] as const;
export type { MatchSlot };
