import type { ApiClient } from './client.ts';
import type {
  BracketDto,
  CategoryDto,
  CourtDto,
  CreateCategoryInput,
  CreateCourtInput,
  CreateMatchInput,
  CreatePlayerInput,
  CreateStageInput,
  CreateTeamInput,
  CreateTournamentInput,
  EntryDto,
  GenerateGroupFixturesInput,
  GenerateKnockoutBracketInput,
  GroupFixturesDto,
  ListQueryParams,
  ListResponseDto,
  MatchDto,
  MatchParticipantDto,
  MatchResultDto,
  PlayerDto,
  PlayerListItemDto,
  QualificationViewDto,
  RecordMatchResultInput,
  RegisterEntryInput,
  ScheduleMatchInput,
  StageDto,
  StandingRowDto,
  TeamDto,
  TeamListItemDto,
  TeamMemberDto,
  TournamentDashboardDto,
  TournamentDto,
  UpdateCategoryInput,
  UpdateCourtInput,
  UpdateEntryInput,
  UpdateMatchInput,
  UpdatePlayerInput,
  UpdateStageInput,
  UpdateTeamInput,
  UpdateTournamentInput,
} from './types.ts';

/**
 * Typed facade over the `/api/v1` REST surface.
 *
 * Each method maps onto one documented endpoint. Payloads follow the request
 * schemas in `@badminton/validation`; responses are the `{ data }` envelopes
 * unwrapped by the transport. The `list` methods return the cursor-paginated
 * collection shape the server sends for tournaments, players and teams.
 */
export interface TournamentApi {
  create(input: CreateTournamentInput, signal?: AbortSignal): Promise<TournamentDto>;
  get(id: string, signal?: AbortSignal): Promise<TournamentDto>;
  /** One page of tournaments, newest first. */
  list(params?: ListQueryParams, signal?: AbortSignal): Promise<ListResponseDto<TournamentDto>>;
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
  /** One page of players, newest first. Omits `email`/`phone` (detail-only). */
  list(params?: ListQueryParams, signal?: AbortSignal): Promise<ListResponseDto<PlayerListItemDto>>;
  update(id: string, input: UpdatePlayerInput, signal?: AbortSignal): Promise<PlayerDto>;
}

export interface TeamApi {
  create(input: CreateTeamInput, signal?: AbortSignal): Promise<TeamDto>;
  get(id: string, signal?: AbortSignal): Promise<TeamDto>;
  /** One page of teams with member counts, newest first. */
  list(params?: ListQueryParams, signal?: AbortSignal): Promise<ListResponseDto<TeamListItemDto>>;
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
  /** Removes an empty stage; the API refuses a stage that still has matches. */
  remove(id: string, signal?: AbortSignal): Promise<void>;
  standings(id: string, signal?: AbortSignal): Promise<readonly StandingRowDto[]>;
  /** Reads the knockout bracket for a KNOCKOUT stage. */
  getBracket(id: string, signal?: AbortSignal): Promise<BracketDto>;
  /** Generates the bracket from a caller-controlled entry ordering. */
  generateBracket(
    id: string,
    input: GenerateKnockoutBracketInput,
    signal?: AbortSignal,
  ): Promise<BracketDto>;
  /** Generates the bracket from the derived group qualifiers. */
  generateBracketFromQualifiers(id: string, signal?: AbortSignal): Promise<BracketDto>;
  /** Reads the derived group qualification view for a KNOCKOUT stage. */
  qualification(id: string, signal?: AbortSignal): Promise<QualificationViewDto>;
  /** Generates the GROUP stage round-robin from a caller-controlled ordering. */
  generateFixtures(
    id: string,
    input: GenerateGroupFixturesInput,
    signal?: AbortSignal,
  ): Promise<GroupFixturesDto>;
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
  /** Records a validated result and completes the match in one transaction. */
  recordResult(
    matchId: string,
    input: RecordMatchResultInput,
    signal?: AbortSignal,
  ): Promise<MatchResultDto>;
  /** Re-scores a completed group match, replacing its stored result. */
  correctResult(
    matchId: string,
    input: RecordMatchResultInput,
    signal?: AbortSignal,
  ): Promise<MatchResultDto>;
  /** Reads the stored result, or `null` while the match is not completed. */
  getResult(matchId: string, signal?: AbortSignal): Promise<MatchResultDto | null>;
  /** Assigns a court and a start/end window to a match. */
  schedule(matchId: string, input: ScheduleMatchInput, signal?: AbortSignal): Promise<MatchDto>;
  /** Clears a future schedule from a match. */
  unschedule(matchId: string, signal?: AbortSignal): Promise<MatchDto>;
}

export interface CourtApi {
  listByTournament(tournamentId: string, signal?: AbortSignal): Promise<readonly CourtDto[]>;
  create(tournamentId: string, input: CreateCourtInput, signal?: AbortSignal): Promise<CourtDto>;
  get(id: string, signal?: AbortSignal): Promise<CourtDto>;
  update(id: string, input: UpdateCourtInput, signal?: AbortSignal): Promise<CourtDto>;
  transition(id: string, status: string, signal?: AbortSignal): Promise<CourtDto>;
}

export interface DashboardApi {
  get(tournamentId: string, signal?: AbortSignal): Promise<TournamentDashboardDto>;
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
  readonly courts: CourtApi;
  readonly dashboard: DashboardApi;
}

/** Builds every domain API module over one shared transport. */
export function createBadmintonApi(client: ApiClient): BadmintonApi {
  return {
    tournaments: {
      create: (input, signal) => client.post('/api/v1/tournaments', input, signal),
      get: (id, signal) => client.get(`/api/v1/tournaments/${id}`, signal),
      list: (params, signal) =>
        client.get<ListResponseDto<TournamentDto>>(listPath('/api/v1/tournaments', params), signal),
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
      list: (params, signal) =>
        client.get<ListResponseDto<PlayerListItemDto>>(listPath('/api/v1/players', params), signal),
      update: (id, input, signal) => client.patch(`/api/v1/players/${id}`, input, signal),
    },
    teams: {
      create: (input, signal) => client.post('/api/v1/teams', input, signal),
      get: (id, signal) => client.get(`/api/v1/teams/${id}`, signal),
      list: (params, signal) =>
        client.get<ListResponseDto<TeamListItemDto>>(listPath('/api/v1/teams', params), signal),
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
      remove: (id, signal) => client.delete(`/api/v1/stages/${id}`, signal),
      standings: (id, signal) => client.get(`/api/v1/stages/${id}/standings`, signal),
      getBracket: (id, signal) => client.get(`/api/v1/stages/${id}/bracket`, signal),
      generateBracket: (id, input, signal) =>
        client.post(`/api/v1/stages/${id}/bracket`, input, signal),
      generateBracketFromQualifiers: (id, signal) =>
        client.post(`/api/v1/stages/${id}/bracket/generate`, undefined, signal),
      qualification: (id, signal) => client.get(`/api/v1/stages/${id}/qualification`, signal),
      generateFixtures: (id, input, signal) =>
        client.post(`/api/v1/stages/${id}/fixtures`, input, signal),
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
      recordResult: (matchId, input, signal) =>
        client.post(`/api/v1/matches/${matchId}/result`, input, signal),
      correctResult: (matchId, input, signal) =>
        client.post(`/api/v1/matches/${matchId}/result/correction`, input, signal),
      getResult: (matchId, signal) =>
        client.get<MatchResultDto | null>(`/api/v1/matches/${matchId}/result`, signal),
      schedule: (matchId, input, signal) =>
        client.post(`/api/v1/matches/${matchId}/schedule`, input, signal),
      unschedule: (matchId, signal) =>
        client.deleteResource<MatchDto>(`/api/v1/matches/${matchId}/schedule`, signal),
    },
    courts: {
      listByTournament: (tournamentId, signal) =>
        client.get(`/api/v1/tournaments/${tournamentId}/courts`, signal),
      create: (tournamentId, input, signal) =>
        client.post(`/api/v1/tournaments/${tournamentId}/courts`, input, signal),
      get: (id, signal) => client.get(`/api/v1/courts/${id}`, signal),
      update: (id, input, signal) => client.patch(`/api/v1/courts/${id}`, input, signal),
      transition: (id, status, signal) =>
        client.post(`/api/v1/courts/${id}/transition`, { status }, signal),
    },
    dashboard: {
      get: (tournamentId, signal) =>
        client.get(`/api/v1/tournaments/${tournamentId}/dashboard`, signal),
    },
  };
}

/** Appends the optional list query parameters to a collection path. */
function listPath(path: string, params: ListQueryParams | undefined): string {
  if (!params) {
    return path;
  }
  const query = new URLSearchParams();
  if (params.limit !== undefined) {
    query.set('limit', String(params.limit));
  }
  if (params.cursor !== undefined) {
    query.set('cursor', params.cursor);
  }
  const encoded = query.toString();
  return encoded.length > 0 ? `${path}?${encoded}` : path;
}
