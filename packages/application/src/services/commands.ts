import type {
  CategoryFormat,
  CategoryGender,
  CategoryStatus,
  CourtStatus,
  MatchScoringRule,
  MatchSlot,
  MatchStatus,
  StageStatus,
  StageType,
  TournamentStatus,
} from '@badminton/domain';

/**
 * Application command types.
 *
 * A service accepts an already shape-validated command. The Zod schemas in
 * `@badminton/validation` produce values compatible with these types at the API
 * boundary; tests construct them directly. Cross-record rules are applied by
 * the services, not here.
 */

export interface CreateTournamentCommand {
  readonly name: string;
  readonly description?: string | null;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly location?: string | null;
  readonly timezone: string;
}

export interface UpdateTournamentCommand {
  readonly name?: string;
  readonly description?: string | null;
  readonly startDate?: Date;
  readonly endDate?: Date;
  readonly location?: string | null;
}

export interface CreateCategoryCommand {
  readonly name: string;
  readonly code: string;
  readonly format: CategoryFormat;
  readonly gender?: CategoryGender | null;
}

export interface UpdateCategoryCommand {
  readonly name?: string;
  readonly format?: CategoryFormat;
  readonly gender?: CategoryGender | null;
}

export interface CreatePlayerCommand {
  readonly name: string;
  readonly email?: string | null;
  readonly phone?: string | null;
}

export interface UpdatePlayerCommand {
  readonly name?: string;
  readonly email?: string | null;
  readonly phone?: string | null;
}

export interface CreateTeamCommand {
  readonly name: string;
  readonly memberPlayerIds?: readonly string[];
}

export interface AddTeamMemberCommand {
  readonly playerId: string;
  readonly position?: number;
}

export interface RegisterEntryCommand {
  readonly categoryId: string;
  readonly playerId?: string;
  readonly teamId?: string;
  readonly seed?: number;
}

export interface UpdateEntryCommand {
  readonly seed?: number | null;
}

export interface CreateStageCommand {
  readonly name: string;
  readonly type: StageType;
  readonly sequence: number;
  readonly drawSize?: number;
  /**
   * How many competitors advance from each group into this stage's feeder
   * knockout. Only meaningful on a KNOCKOUT stage; `undefined` leaves it unset.
   */
  readonly qualifiersPerGroup?: number;
  /**
   * Per-round knockout scoring configuration, keyed by round tag. Only
   * meaningful on a KNOCKOUT stage; `undefined` leaves it unset (the domain
   * defaults then apply).
   */
  readonly knockoutRules?: Readonly<Record<string, MatchScoringRule>>;
}

export interface UpdateStageCommand {
  readonly name?: string;
  readonly sequence?: number;
  readonly drawSize?: number | null;
  readonly qualifiersPerGroup?: number | null;
  /** Per-round knockout scoring configuration; refused once the bracket exists. */
  readonly knockoutRules?: Readonly<Record<string, MatchScoringRule>> | null;
}

export interface CreateMatchCommand {
  readonly sequence: number;
  readonly roundNumber?: number;
  readonly matchNumber?: number;
}

export interface UpdateMatchCommand {
  readonly sequence?: number;
  readonly roundNumber?: number | null;
  readonly matchNumber?: number | null;
}

export interface AddMatchParticipantCommand {
  readonly entryId: string;
  readonly slot: MatchSlot;
}

/**
 * A single game in a result submission. `gameNumber` is 1-based and the points
 * belong to participant slots 1 and 2; the winner is never supplied.
 */
export interface RecordMatchGameCommand {
  readonly gameNumber: number;
  readonly participant1Points: number;
  readonly participant2Points: number;
}

/**
 * Records a complete result for an in-progress match and transitions it to
 * `COMPLETED` in one transaction. The games are validated by the domain scoring
 * rules and the winner is derived, not supplied.
 */
export interface RecordMatchResultCommand {
  readonly games: readonly RecordMatchGameCommand[];
}

/**
 * Status transitions accepted by the lifecycle endpoints.
 *
 * Cancellation is modelled explicitly rather than by assigning an arbitrary
 * enum value, so a caller cannot silently move an aggregate to any status.
 */
export interface TransitionTournamentStatusCommand {
  readonly status: TournamentStatus;
}

export interface TransitionCategoryStatusCommand {
  readonly status: CategoryStatus;
}

export interface TransitionStageStatusCommand {
  readonly status: StageStatus;
}

export interface TransitionMatchStatusCommand {
  readonly status: MatchStatus;
}

/**
 * Generates a single-elimination bracket for a KNOCKOUT stage.
 *
 * Two mutually exclusive ways to supply the draw:
 *
 * - `entryIds` - the caller-controlled ordering: entries are paired in the
 *   supplied order (1 vs 2, 3 vs 4, ...) into round 1. The count must be a
 *   supported bracket size. There is deliberately no automatic seeding or
 *   ranking - the caller decides the order.
 * - `pairings` - explicit first-round pairings, where `second` may be `null`
 *   for a bye. Used by qualification, which seeds the qualifiers (cross-seed or
 *   snake-fold) and spreads byes across the round. The number of pairings is the
 *   bracket size / 2.
 *
 * Exactly one of the two must be supplied.
 */
export interface GenerateKnockoutBracketCommand {
  readonly entryIds?: readonly string[];
  readonly pairings?: readonly KnockoutPairingInput[];
}

/** One first-round pairing; `second` is `null` for a bye. */
export interface KnockoutPairingInput {
  readonly first: string;
  readonly second: string | null;
}

/** Reads a knockout bracket, optionally refreshing stage completion. */
export interface GetKnockoutBracketQuery {
  readonly stageId: string;
}

/**
 * Generates a complete round-robin for a GROUP stage.
 *
 * `entryIds` is the caller-controlled ordering: the supplied entries are
 * scheduled in order into the round-robin (every entry plays every other entry
 * exactly once). There is deliberately no automatic seeding or ranking - the
 * caller decides the order.
 */
export interface GenerateGroupFixturesCommand {
  readonly entryIds: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Phase 7 - court management and match scheduling                     */
/* ------------------------------------------------------------------ */

export interface CreateCourtCommand {
  readonly number: number;
  readonly name: string;
}

export interface UpdateCourtCommand {
  readonly number?: number;
  readonly name?: string;
}

export interface TransitionCourtStatusCommand {
  readonly status: CourtStatus;
}

/**
 * Assigns a match to a court for a bounded window.
 *
 * Both times are required: a schedule is a `[start, end)` interval so that a
 * later match's start can be compared against an earlier match's end. The court
 * must belong to the match's tournament; the interval must be positive; the
 * court must be active and the match must be in a schedulable state.
 */
export interface ScheduleMatchCommand {
  readonly courtId: string;
  readonly scheduledStartAt: Date;
  readonly scheduledEndAt: Date;
}
