import type { ApiClient } from './client.ts';
import type {
  CategoryDto,
  CreateCategoryInput,
  CreateMatchInput,
  CreatePlayerInput,
  CreateStageInput,
  CreateTeamInput,
  CreateTournamentInput,
  EntryDto,
  MatchDto,
  MatchParticipantDto,
  PlayerDto,
  RegisterEntryInput,
  StageDto,
  TeamDto,
  TeamMemberDto,
  TournamentDto,
  UpdateCategoryInput,
  UpdateEntryInput,
  UpdateMatchInput,
  UpdatePlayerInput,
  UpdateStageInput,
  UpdateTeamInput,
  UpdateTournamentInput,
} from './types.ts';

/**
 * Typed facade over the Phase 3 `/api/v1` REST surface.
 *
 * Each method maps onto one documented endpoint; no method invents a
 * collection query the API does not expose (notably listing tournaments and
 * players/search). Payloads follow the request schemas in
 * `@badminton/validation`; responses are the `{ data }` envelopes unwrapped by
 * the transport.
 */
export interface TournamentApi {
  create(input: CreateTournamentInput, signal?: AbortSignal): Promise<TournamentDto>;
  get(id: string, signal?: AbortSignal): Promise<TournamentDto>;
  update(id: string, input: UpdateTournamentInput, signal?: AbortSignal): Promise<TournamentDto>;
  transition(id: string, status: string, signal?: AbortSignal): Promise<TournamentDto>;
}

export interface CategoryApi {
  listByTournament(tournamentId: string, signal?: AbortSignal): Promise<readonly CategoryDto[]>;
  create(
    tournamentId: string,
    input: CreateCategoryInput,
    signal?: AbortSignal,
  ): Promise<CategoryDto>;
  get(id: string, signal?: AbortSignal): Promise<CategoryDto>;
  update(id: string, input: UpdateCategoryInput, signal?: AbortSignal): Promise<CategoryDto>;
  transition(id: string, status: string, signal?: AbortSignal): Promise<CategoryDto>;
}

export interface PlayerApi {
  create(input: CreatePlayerInput, signal?: AbortSignal): Promise<PlayerDto>;
  get(id: string, signal?: AbortSignal): Promise<PlayerDto>;
  update(id: string, input: UpdatePlayerInput, signal?: AbortSignal): Promise<PlayerDto>;
}

export interface TeamApi {
  create(input: CreateTeamInput, signal?: AbortSignal): Promise<TeamDto>;
  get(id: string, signal?: AbortSignal): Promise<TeamDto>;
  update(id: string, input: UpdateTeamInput, signal?: AbortSignal): Promise<TeamDto>;
  listMembers(teamId: string, signal?: AbortSignal): Promise<readonly TeamMemberDto[]>;
  addMember(
    teamId: string,
    input: { playerId: string; position?: number },
    signal?: AbortSignal,
  ): Promise<TeamMemberDto>;
  removeMember(teamId: string, playerId: string, signal?: AbortSignal): Promise<void>;
}

export interface EntryApi {
  listByCategory(categoryId: string, signal?: AbortSignal): Promise<readonly EntryDto[]>;
  register(categoryId: string, input: RegisterEntryInput, signal?: AbortSignal): Promise<EntryDto>;
  get(id: string, signal?: AbortSignal): Promise<EntryDto>;
  update(id: string, input: UpdateEntryInput, signal?: AbortSignal): Promise<EntryDto>;
  confirm(id: string, signal?: AbortSignal): Promise<EntryDto>;
  withdraw(id: string, signal?: AbortSignal): Promise<EntryDto>;
  disqualify(id: string, signal?: AbortSignal): Promise<EntryDto>;
}

export interface StageApi {
  listByCategory(categoryId: string, signal?: AbortSignal): Promise<readonly StageDto[]>;
  create(categoryId: string, input: CreateStageInput, signal?: AbortSignal): Promise<StageDto>;
  get(id: string, signal?: AbortSignal): Promise<StageDto>;
  update(id: string, input: UpdateStageInput, signal?: AbortSignal): Promise<StageDto>;
  transition(id: string, status: string, signal?: AbortSignal): Promise<StageDto>;
}

export interface MatchApi {
  listByStage(stageId: string, signal?: AbortSignal): Promise<readonly MatchDto[]>;
  create(stageId: string, input: CreateMatchInput, signal?: AbortSignal): Promise<MatchDto>;
  get(id: string, signal?: AbortSignal): Promise<MatchDto>;
  update(id: string, input: UpdateMatchInput, signal?: AbortSignal): Promise<MatchDto>;
  transition(id: string, status: string, signal?: AbortSignal): Promise<MatchDto>;
  listParticipants(matchId: string, signal?: AbortSignal): Promise<readonly MatchParticipantDto[]>;
  addParticipant(
    matchId: string,
    input: { entryId: string; slot: 1 | 2 },
    signal?: AbortSignal,
  ): Promise<MatchParticipantDto>;
}

/** The complete API surface consumed by the tournament setup UI. */
export interface BadmintonApi {
  readonly tournaments: TournamentApi;
  readonly categories: CategoryApi;
  readonly players: PlayerApi;
  readonly teams: TeamApi;
  readonly entries: EntryApi;
  readonly stages: StageApi;
  readonly matches: MatchApi;
}

/** Builds every domain API module over one shared transport. */
export function createBadmintonApi(client: ApiClient): BadmintonApi {
  return {
    tournaments: {
      create: (input, signal) => client.post('/api/v1/tournaments', input, signal),
      get: (id, signal) => client.get(`/api/v1/tournaments/${id}`, signal),
      update: (id, input, signal) => client.patch(`/api/v1/tournaments/${id}`, input, signal),
      transition: (id, status, signal) =>
        client.post(`/api/v1/tournaments/${id}/transition`, { status }, signal),
    },
    categories: {
      listByTournament: (tournamentId, signal) =>
        client.get(`/api/v1/tournaments/${tournamentId}/categories`, signal),
      create: (tournamentId, input, signal) =>
        client.post(`/api/v1/tournaments/${tournamentId}/categories`, input, signal),
      get: (id, signal) => client.get(`/api/v1/categories/${id}`, signal),
      update: (id, input, signal) => client.patch(`/api/v1/categories/${id}`, input, signal),
      transition: (id, status, signal) =>
        client.post(`/api/v1/categories/${id}/transition`, { status }, signal),
    },
    players: {
      create: (input, signal) => client.post('/api/v1/players', input, signal),
      get: (id, signal) => client.get(`/api/v1/players/${id}`, signal),
      update: (id, input, signal) => client.patch(`/api/v1/players/${id}`, input, signal),
    },
    teams: {
      create: (input, signal) => client.post('/api/v1/teams', input, signal),
      get: (id, signal) => client.get(`/api/v1/teams/${id}`, signal),
      update: (id, input, signal) => client.patch(`/api/v1/teams/${id}`, input, signal),
      listMembers: (teamId, signal) => client.get(`/api/v1/teams/${teamId}/members`, signal),
      addMember: (teamId, input, signal) =>
        client.post(`/api/v1/teams/${teamId}/members`, input, signal),
      removeMember: (teamId, playerId, signal) =>
        client.delete(`/api/v1/teams/${teamId}/members/${playerId}`, signal),
    },
    entries: {
      listByCategory: (categoryId, signal) =>
        client.get(`/api/v1/categories/${categoryId}/entries`, signal),
      register: (categoryId, input, signal) =>
        client.post(`/api/v1/categories/${categoryId}/entries`, input, signal),
      get: (id, signal) => client.get(`/api/v1/entries/${id}`, signal),
      update: (id, input, signal) => client.patch(`/api/v1/entries/${id}`, input, signal),
      confirm: (id, signal) => client.post(`/api/v1/entries/${id}/confirm`, undefined, signal),
      withdraw: (id, signal) => client.post(`/api/v1/entries/${id}/withdraw`, undefined, signal),
      disqualify: (id, signal) =>
        client.post(`/api/v1/entries/${id}/disqualify`, undefined, signal),
    },
    stages: {
      listByCategory: (categoryId, signal) =>
        client.get(`/api/v1/categories/${categoryId}/stages`, signal),
      create: (categoryId, input, signal) =>
        client.post(`/api/v1/categories/${categoryId}/stages`, input, signal),
      get: (id, signal) => client.get(`/api/v1/stages/${id}`, signal),
      update: (id, input, signal) => client.patch(`/api/v1/stages/${id}`, input, signal),
      transition: (id, status, signal) =>
        client.post(`/api/v1/stages/${id}/transition`, { status }, signal),
    },
    matches: {
      listByStage: (stageId, signal) => client.get(`/api/v1/stages/${stageId}/matches`, signal),
      create: (stageId, input, signal) =>
        client.post(`/api/v1/stages/${stageId}/matches`, input, signal),
      get: (id, signal) => client.get(`/api/v1/matches/${id}`, signal),
      update: (id, input, signal) => client.patch(`/api/v1/matches/${id}`, input, signal),
      transition: (id, status, signal) =>
        client.post(`/api/v1/matches/${id}/transition`, { status }, signal),
      listParticipants: (matchId, signal) =>
        client.get(`/api/v1/matches/${matchId}/participants`, signal),
      addParticipant: (matchId, input, signal) =>
        client.post(`/api/v1/matches/${matchId}/participants`, input, signal),
    },
  };
}
