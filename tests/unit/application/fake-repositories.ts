/* eslint-disable @typescript-eslint/require-await -- the fake ports implement
   async signatures over synchronous in-memory maps; there is nothing to await. */
import type {
  CreateCategoryData,
  CreateEntryData,
  CreateMatchData,
  CreateMatchParticipantData,
  CreatePlayerData,
  CreateStageData,
  CreateTeamData,
  CreateTeamMemberData,
  CreateTournamentData,
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
import {
  ConflictError,
  type CategoryStatus,
  type EntryStatus,
  type Match,
  type MatchParticipant,
  type MatchSlot,
  type MatchStatus,
  type Player,
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
}

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(sequence).padStart(6, '0')}`;
}

function now(): Date {
  return new Date('2026-01-01T00:00:00.000Z');
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
  };

  const matches: MatchRepository = {
    async create(data: CreateMatchData): Promise<Match> {
      assertUnique(
        ![...state.matches.values()].some(
          (row) => row.stageId === data.stageId && row.sequence === data.sequence,
        ),
        'matches_stageId_sequence_key',
      );
      const row: Match = { id: nextId('match'), ...data, createdAt: now(), updatedAt: now() };
      state.matches.set(row.id, row);
      return row;
    },
    async findById(id) {
      return state.matches.get(id);
    },
    async listByStage(stageId) {
      return [...state.matches.values()].filter((row) => row.stageId === stageId);
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
    async listByMatch(matchId) {
      return [...state.matchParticipants.values()].filter((row) => row.matchId === matchId);
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
