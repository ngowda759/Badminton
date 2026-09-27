import type {
  CategoryStatus,
  Court,
  CourtStatus,
  EntryStatus,
  Match,
  MatchGame,
  MatchParticipant,
  MatchStatus,
  Player,
  StageStatus,
  Team,
  TeamMember,
  Tournament,
  TournamentCategory,
  TournamentEntry,
  TournamentStage,
} from '@badminton/domain';

import type {
  CreateCategoryData,
  CreateCourtData,
  CreateEntryData,
  CreateMatchData,
  CreateMatchGameData,
  CreateMatchParticipantData,
  CreatePlayerData,
  CreateStageData,
  CreateTeamData,
  CreateTeamMemberData,
  CreateTournamentData,
  MatchGameWithMatch,
  MatchScheduleData,
  UpdateCategoryData,
  UpdateCourtData,
  UpdateMatchData,
  UpdatePlayerData,
  UpdateStageData,
  UpdateTeamData,
  UpdateTournamentData,
} from './data.ts';

/**
 * Repository ports for the Phase 2 aggregates.
 *
 * A port exposes only the operations the services need - never a raw Prisma
 * client - and speaks in domain types. Implementations live in
 * `@badminton/infrastructure`; the application layer depends on these
 * interfaces so it can be unit-tested with stubs and never imports Prisma.
 *
 * Every method belongs to a `RepositoryClient`. Services run a compound
 * operation inside `runInTransaction`, which hands them the client bound to the
 * active transaction; outside a transaction they receive the default client.
 */

/** The set of repositories bound to one transaction (or the default client). */
export interface RepositoryClient {
  readonly tournaments: TournamentRepository;
  readonly categories: TournamentCategoryRepository;
  readonly players: PlayerRepository;
  readonly teams: TeamRepository;
  readonly teamMembers: TeamMemberRepository;
  readonly entries: TournamentEntryRepository;
  readonly stages: TournamentStageRepository;
  readonly matches: MatchRepository;
  readonly matchParticipants: MatchParticipantRepository;
  readonly matchGames: MatchGameRepository;
  readonly courts: CourtRepository;
}

export interface CourtRepository {
  create(data: CreateCourtData): Promise<Court>;
  findById(id: string): Promise<Court | undefined>;
  /** All courts of a tournament, ordered by court number. */
  listByTournament(tournamentId: string): Promise<readonly Court[]>;
  update(id: string, data: UpdateCourtData): Promise<Court>;
  updateStatus(id: string, status: CourtStatus): Promise<Court>;
}

export interface TournamentRepository {
  create(data: CreateTournamentData): Promise<Tournament>;
  findById(id: string): Promise<Tournament | undefined>;
  update(id: string, data: UpdateTournamentData): Promise<Tournament>;
  updateStatus(id: string, status: Tournament['status']): Promise<Tournament>;
}

export interface TournamentCategoryRepository {
  create(data: CreateCategoryData): Promise<TournamentCategory>;
  findById(id: string): Promise<TournamentCategory | undefined>;
  listByTournament(tournamentId: string): Promise<readonly TournamentCategory[]>;
  update(id: string, data: UpdateCategoryData): Promise<TournamentCategory>;
  updateStatus(id: string, status: CategoryStatus): Promise<TournamentCategory>;
  countEntries(categoryId: string): Promise<number>;
}

export interface PlayerRepository {
  create(data: CreatePlayerData): Promise<Player>;
  findById(id: string): Promise<Player | undefined>;
  findByEmail(email: string): Promise<Player | undefined>;
  findByPhone(phone: string): Promise<Player | undefined>;
  /** Players for several ids, so the dashboard avoids a per-participant query. */
  listByIds(ids: readonly string[]): Promise<readonly Player[]>;
  update(id: string, data: UpdatePlayerData): Promise<Player>;
}

export interface TeamRepository {
  create(data: CreateTeamData): Promise<Team>;
  findById(id: string): Promise<Team | undefined>;
  /** Teams for several ids, so the dashboard avoids a per-participant query. */
  listByIds(ids: readonly string[]): Promise<readonly Team[]>;
  update(id: string, data: UpdateTeamData): Promise<Team>;
}

export interface TeamMemberRepository {
  create(data: CreateTeamMemberData): Promise<TeamMember>;
  listByTeam(teamId: string): Promise<readonly TeamMember[]>;
  findMembership(teamId: string, playerId: string): Promise<TeamMember | undefined>;
  remove(teamId: string, playerId: string): Promise<void>;
}

export interface TournamentEntryRepository {
  create(data: CreateEntryData): Promise<TournamentEntry>;
  findById(id: string): Promise<TournamentEntry | undefined>;
  findByCategoryAndPlayer(
    categoryId: string,
    playerId: string,
  ): Promise<TournamentEntry | undefined>;
  findByCategoryAndTeam(categoryId: string, teamId: string): Promise<TournamentEntry | undefined>;
  /**
   * Finds a non-terminal entry for `playerId` in any team registered into
   * `categoryId` other than `excludedTeamId`. Backs invariant 17 (a player may
   * appear in at most one team per category).
   */
  findCompetingTeamEntry(
    categoryId: string,
    playerId: string,
    excludedTeamId: string,
  ): Promise<TournamentEntry | undefined>;
  listByCategory(categoryId: string): Promise<readonly TournamentEntry[]>;
  /** All entries of a tournament (through its categories), in one read. */
  listByTournament(tournamentId: string): Promise<readonly TournamentEntry[]>;
  updateSeed(id: string, seed: number | null): Promise<TournamentEntry>;
  updateStatus(id: string, status: EntryStatus): Promise<TournamentEntry>;
}

export interface TournamentStageRepository {
  create(data: CreateStageData): Promise<TournamentStage>;
  findById(id: string): Promise<TournamentStage | undefined>;
  listByCategory(categoryId: string): Promise<readonly TournamentStage[]>;
  /** All stages of a tournament (through its categories), in one read. */
  listByTournament(tournamentId: string): Promise<readonly TournamentStage[]>;
  update(id: string, data: UpdateStageData): Promise<TournamentStage>;
  updateStatus(id: string, status: StageStatus): Promise<TournamentStage>;
}

export interface MatchRepository {
  create(data: CreateMatchData): Promise<Match>;
  findById(id: string): Promise<Match | undefined>;
  listByStage(stageId: string): Promise<readonly Match[]>;
  /** Completed matches only, scoped to one stage (drives group standings). */
  listCompletedByStage(stageId: string): Promise<readonly Match[]>;
  /**
   * Every match of a stage together with its participants, in one batched read
   * (no N+1). Drives knockout bracket retrieval.
   */
  listByStageWithParticipants(stageId: string): Promise<readonly MatchWithParticipants[]>;
  update(id: string, data: UpdateMatchData): Promise<Match>;
  updateStatus(id: string, status: MatchStatus): Promise<Match>;
  /** Writes the derived winner and the terminal status in one update. */
  complete(id: string, winnerEntryId: string): Promise<Match>;
  /**
   * Atomically writes the whole scheduling slice of a match (court and both
   * times). Persisting all three together keeps the match from ever holding a
   * partial schedule; the database exclusion constraint is the final guard.
   */
  schedule(id: string, data: MatchScheduleData): Promise<Match>;
  /** Clears the court and both times together. */
  unschedule(id: string): Promise<Match>;
  /** Scheduled/in-progress/completed matches of a tournament, in one read. */
  listByTournament(tournamentId: string): Promise<readonly Match[]>;
  /** Whether `courtId` already has a match overlapping the requested window. */
  findOverlappingSchedule(
    courtId: string,
    startAt: Date,
    endAt: Date,
    excludeMatchId?: string,
  ): Promise<Match | undefined>;
  /** Matches on one court, ordered by scheduled start. */
  listByCourt(courtId: string): Promise<readonly Match[]>;
}

/** A match read together with its participants, for batched bracket reads. */
export interface MatchWithParticipants {
  readonly match: Match;
  readonly participants: readonly MatchParticipant[];
}

export interface MatchParticipantRepository {
  create(data: CreateMatchParticipantData): Promise<MatchParticipant>;
  listByMatch(matchId: string): Promise<readonly MatchParticipant[]>;
  /** Participants for several matches, so standings avoids a per-match query. */
  listByMatchIds(matchIds: readonly string[]): Promise<readonly MatchParticipant[]>;
  findSlot(matchId: string, slot: number): Promise<MatchParticipant | undefined>;
  findEntry(matchId: string, entryId: string): Promise<MatchParticipant | undefined>;
  /**
   * Fills an *empty* slot with an entry; creates the participant row.
   *
   * Deliberately not an upsert: knockout progression must never overwrite an
   * occupied slot. `fillSlot` is create-only, so a taken slot raises a conflict
   * (via the compound unique index) rather than silently replacing a different
   * entry. Callers that need idempotency check the current slot first with
   * `findSlot`.
   */
  fillSlot(matchId: string, slot: number, entryId: string): Promise<MatchParticipant>;
}

export interface MatchGameRepository {
  createMany(data: readonly CreateMatchGameData[]): Promise<readonly MatchGame[]>;
  listByMatch(matchId: string): Promise<readonly MatchGame[]>;
  /** Games across several matches (with their owner), so standings avoids N+1. */
  listByMatchIds(matchIds: readonly string[]): Promise<readonly MatchGameWithMatch[]>;
}
