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
  RealtimeEvent,
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
  CreateRealtimeEventData,
  CreateStageData,
  CreateTeamData,
  CreateTeamMemberData,
  CreateTournamentData,
  ListPage,
  ListQuery,
  MatchGameWithMatch,
  MatchScheduleData,
  TeamWithMemberCount,
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
  readonly realtimeEvents: RealtimeEventRepository;
}

/**
 * Transactional outbox port.
 *
 * `create` is always called with the caller's transactional client so the event
 * and the business change commit together. `getPendingEvents` and
 * `markPublished` are dispatcher-side operations and run on the default client.
 */
export interface RealtimeEventRepository {
  create(data: CreateRealtimeEventData): Promise<RealtimeEvent>;
  /** Unpublished events, oldest first, bounded by `limit`. */
  getPendingEvents(limit: number): Promise<readonly RealtimeEvent[]>;
  /** Stamps `publishedAt`; a no-op when the row is already published. */
  markPublished(id: string): Promise<void>;
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
  /** One page of tournaments, newest first, resuming after `query.cursor`. */
  listPage(query: ListQuery): Promise<ListPage<Tournament>>;
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
  /** One page of players, newest first then id, resuming after `query.cursor`. */
  listPage(query: ListQuery): Promise<ListPage<Player>>;
  /** Players for several ids, so the dashboard avoids a per-participant query. */
  listByIds(ids: readonly string[]): Promise<readonly Player[]>;
  update(id: string, data: UpdatePlayerData): Promise<Player>;
}

export interface TeamRepository {
  create(data: CreateTeamData): Promise<Team>;
  findById(id: string): Promise<Team | undefined>;
  /** One page of teams with member counts, newest first, after `query.cursor`. */
  listPageWithMemberCount(query: ListQuery): Promise<ListPage<TeamWithMemberCount>>;
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
  /**
   * Creates every match of a stage in one write, so a generated fixture set or
   * bracket is never left partially persisted by a round trip per row. Used by
   * the group-fixture and knockout-bracket generators; the stage-unique
   * `(stageId, sequence)` index is the database's final guard.
   */
  createMany(data: readonly CreateMatchData[]): Promise<readonly Match[]>;
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
   * Clears the derived winner and returns the match to `IN_PROGRESS` in one
   * update, so a correction can re-score it. The stored games are removed
   * separately by `MatchGameRepository.deleteByMatch`, in the same transaction.
   */
  clearResult(id: string): Promise<Match>;
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
  /**
   * Creates several participants in one write. Used by the fixture and bracket
   * generators so a generated set is inserted in a single statement rather than
   * one round trip per slot.
   */
  createMany(data: readonly CreateMatchParticipantData[]): Promise<readonly MatchParticipant[]>;
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
  /** Removes every stored game of one match, so a correction can replace them. */
  deleteByMatch(matchId: string): Promise<void>;
  listByMatch(matchId: string): Promise<readonly MatchGame[]>;
  /** Games across several matches (with their owner), so standings avoids N+1. */
  listByMatchIds(matchIds: readonly string[]): Promise<readonly MatchGameWithMatch[]>;
}
