import type { CategoryFormat, CategoryGender } from '@badminton/domain';
import type {
  CategoryStatus,
  CourtStatus,
  EntryStatus,
  MatchSlot,
  MatchStatus,
  StageStatus,
  StageType,
  TournamentStatus,
} from '@badminton/domain';

export type { CategoryFormat, CategoryGender, StageType } from '@badminton/domain';

/**
 * Serialized shapes returned by the Phase 3 REST API.
 *
 * These mirror the domain aggregates but describe JSON: calendar dates arrive
 * as ISO-8601 strings, not `Date` instances. The status/format unions are
 * reused from the dependency-free `@badminton/domain` package so the browser
 * shares one vocabulary with the server without importing server internals.
 */

export interface TournamentDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly startDate: string;
  readonly endDate: string;
  readonly location: string | null;
  readonly timezone: string;
  readonly status: TournamentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CategoryDto {
  readonly id: string;
  readonly tournamentId: string;
  readonly name: string;
  readonly code: string;
  readonly format: CategoryFormat;
  readonly gender: CategoryGender | null;
  readonly status: CategoryStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlayerDto {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One player row in `GET /api/v1/players`.
 *
 * The collection lists every player, so the server omits `email`/`phone` here;
 * those stay on the single-player `PlayerDto` returned by the detail/edit
 * endpoints.
 */
export interface PlayerListItemDto {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TeamDto {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One team row in `GET /api/v1/teams`, with its derived member count. */
export interface TeamListItemDto {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A cursor-paginated collection response from the list endpoints. */
export interface ListResponseDto<T> {
  readonly items: readonly T[];
  /** Opaque cursor for the next page, or `null` on the last page. */
  readonly nextCursor: string | null;
}

/** Query accepted by the collection endpoints. */
export interface ListQueryParams {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface TeamMemberDto {
  readonly id: string;
  readonly teamId: string;
  readonly playerId: string;
  readonly position: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EntryDto {
  readonly id: string;
  readonly categoryId: string;
  readonly playerId: string | null;
  readonly teamId: string | null;
  readonly seed: number | null;
  readonly status: EntryStatus;
  readonly registeredAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StageDto {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly type: StageType;
  readonly sequence: number;
  readonly drawSize: number | null;
  readonly status: StageStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MatchDto {
  readonly id: string;
  readonly stageId: string;
  readonly sequence: number;
  readonly roundNumber: number | null;
  readonly matchNumber: number | null;
  readonly status: MatchStatus;
  /** Set once the match is completed; the winning entry. */
  readonly winnerEntryId: string | null;
  readonly courtId: string | null;
  readonly scheduledStartAt: string | null;
  readonly scheduledEndAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MatchParticipantDto {
  readonly id: string;
  readonly matchId: string;
  readonly entryId: string;
  readonly slot: MatchSlot;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A single game of a completed match as returned by the result endpoint. */
export interface MatchGameDto {
  readonly gameNumber: number;
  readonly participant1Points: number;
  readonly participant2Points: number;
  readonly winnerSlot: MatchSlot;
}

/** A recorded match result, including the resolved winner entry. */
export interface MatchResultDto {
  readonly matchId: string;
  readonly winnerSlot: MatchSlot;
  readonly winnerGames: number;
  readonly loserGames: number;
  readonly winnerEntryId: string;
  readonly loserEntryId: string;
  readonly games: readonly MatchGameDto[];
}

/** One derived line of a group standings table. */
export interface StandingRowDto {
  readonly entryId: string;
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly points: number;
  readonly gamesWon: number;
  readonly gamesLost: number;
  readonly gameDifference: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly pointDifference: number;
  readonly position: number;
}

/** One participant slot of a knockout match; `entryId` is null until filled. */
export interface BracketParticipantDto {
  readonly slot: MatchSlot;
  readonly entryId: string | null;
}

/** One match in a knockout bracket. */
export interface BracketMatchDto {
  readonly matchId: string;
  readonly matchNumber: number;
  readonly sequence: number;
  readonly status: MatchStatus;
  readonly participant1: BracketParticipantDto;
  readonly participant2: BracketParticipantDto;
  readonly winnerEntryId: string | null;
}

/** One round of a knockout bracket. */
export interface BracketRoundDto {
  readonly roundNumber: number;
  readonly name: string;
  readonly matches: readonly BracketMatchDto[];
}

/** The full bracket returned by `GET /stages/:id/bracket`. */
export interface BracketDto {
  readonly stageId: string;
  readonly stageName: string;
  readonly status: StageStatus;
  readonly bracketSize: number;
  readonly roundCount: number;
  readonly rounds: readonly BracketRoundDto[];
  readonly complete: boolean;
}

/** One participant slot of a group fixture; both slots are always filled. */
export interface GroupFixtureParticipantDto {
  readonly slot: MatchSlot;
  readonly entryId: string;
}

/** One group fixture (a single round-robin match). */
export interface GroupFixtureMatchDto {
  readonly matchId: string;
  readonly sequence: number;
  readonly roundNumber: number;
  readonly status: MatchStatus;
  readonly participant1: GroupFixtureParticipantDto;
  readonly participant2: GroupFixtureParticipantDto;
}

/** The full fixture set returned by `POST /stages/:id/fixtures`. */
export interface GroupFixturesDto {
  readonly stageId: string;
  readonly stageName: string;
  readonly status: StageStatus;
  readonly competitorCount: number;
  readonly matchCount: number;
  readonly matches: readonly GroupFixtureMatchDto[];
}

/** A tournament court as returned by the court endpoints. */
export interface CourtDto {
  readonly id: string;
  readonly tournamentId: string;
  readonly number: number;
  readonly name: string;
  readonly status: CourtStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A resolved competitor name for a dashboard match participant slot. */
export interface DashboardCompetitorDto {
  readonly entryId: string | null;
  readonly name: string | null;
  readonly slot: number;
}

/** A match shown on the dashboard, with enough context to render a card. */
export interface DashboardMatchDto {
  readonly matchId: string;
  readonly status: MatchStatus;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly stageId: string;
  readonly stageName: string;
  readonly courtId: string | null;
  readonly courtName: string | null;
  readonly courtNumber: number | null;
  readonly scheduledStartAt: string | null;
  readonly scheduledEndAt: string | null;
  readonly participants: readonly DashboardCompetitorDto[];
  readonly winnerEntryId: string | null;
}

/** A court with a derived busy flag (never persisted). */
export interface DashboardCourtDto {
  readonly courtId: string;
  readonly number: number;
  readonly name: string;
  readonly status: CourtStatus;
  readonly busy: boolean;
}

/** Per-stage progress within a dashboard category. */
export interface DashboardStageProgressDto {
  readonly stageId: string;
  readonly name: string;
  readonly type: StageType;
  readonly status: StageStatus;
  readonly totalMatches: number;
  readonly completedMatches: number;
}

/** Per-category progress aggregating its stages. */
export interface DashboardCategoryProgressDto {
  readonly categoryId: string;
  readonly name: string;
  readonly code: string;
  readonly totalMatches: number;
  readonly completedMatches: number;
  readonly stages: readonly DashboardStageProgressDto[];
}

/** Aggregate match/entry counts for the dashboard. */
export interface DashboardSummaryDto {
  readonly totalEntries: number;
  readonly totalMatches: number;
  readonly completedMatches: number;
  readonly inProgressMatches: number;
  readonly scheduledMatches: number;
  readonly unscheduledMatches: number;
}

/** The aggregated dashboard payload returned by the dashboard endpoint. */
export interface TournamentDashboardDto {
  readonly tournament: TournamentDto;
  readonly summary: DashboardSummaryDto;
  readonly courts: readonly DashboardCourtDto[];
  readonly liveMatches: readonly DashboardMatchDto[];
  readonly upcomingMatches: readonly DashboardMatchDto[];
  readonly recentResults: readonly DashboardMatchDto[];
  readonly unscheduledMatches: readonly DashboardMatchDto[];
  readonly categories: readonly DashboardCategoryProgressDto[];
}

/* ------------------------------------------------------------------ */
/* Request payloads                                                    */
/* ------------------------------------------------------------------ */

export interface CreateTournamentInput {
  readonly name: string;
  readonly description?: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly location?: string;
  readonly timezone: string;
}

export interface UpdateTournamentInput {
  readonly name?: string;
  readonly description?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly location?: string;
}

export interface CreateCategoryInput {
  readonly name: string;
  readonly code: string;
  readonly format: CategoryFormat;
  readonly gender?: CategoryGender | null;
}

export interface UpdateCategoryInput {
  readonly name?: string;
  readonly format?: CategoryFormat;
  readonly gender?: CategoryGender | null;
}

export interface CreatePlayerInput {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
}

export interface UpdatePlayerInput {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
}

export interface CreateTeamInput {
  readonly name: string;
  readonly memberPlayerIds?: readonly string[];
}

export interface UpdateTeamInput {
  readonly name: string;
}

export interface AddTeamMemberInput {
  readonly playerId: string;
  readonly position?: number;
}

export interface RegisterEntryInput {
  readonly playerId?: string;
  readonly teamId?: string;
  readonly seed?: number;
}

export interface UpdateEntryInput {
  readonly seed: number | null;
}

export interface CreateStageInput {
  readonly name: string;
  readonly type: StageType;
  readonly sequence: number;
  readonly drawSize?: number;
}

export interface UpdateStageInput {
  readonly name?: string;
  readonly sequence?: number;
  readonly drawSize?: number | null;
}

export interface CreateMatchInput {
  readonly sequence: number;
  readonly roundNumber?: number;
  readonly matchNumber?: number;
}

export interface UpdateMatchInput {
  readonly sequence?: number;
  readonly roundNumber?: number | null;
  readonly matchNumber?: number | null;
}

export interface AddMatchParticipantInput {
  readonly entryId: string;
  readonly slot: MatchSlot;
}

export interface RecordMatchGameInput {
  readonly gameNumber: number;
  readonly participant1Points: number;
  readonly participant2Points: number;
}

export interface RecordMatchResultInput {
  readonly games: readonly RecordMatchGameInput[];
}

/** Generates a knockout bracket from a caller-supplied entry ordering. */
export interface GenerateKnockoutBracketInput {
  readonly entryIds: readonly string[];
}

/** Generates a GROUP stage round-robin from a caller-supplied entry ordering. */
export interface GenerateGroupFixturesInput {
  readonly entryIds: readonly string[];
}

export interface CreateCourtInput {
  readonly number: number;
  readonly name: string;
}

export interface UpdateCourtInput {
  readonly number?: number;
  readonly name?: string;
}

export interface ScheduleMatchInput {
  readonly courtId: string;
  readonly scheduledStartAt: string;
  readonly scheduledEndAt: string;
}
