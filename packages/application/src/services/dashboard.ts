import type { CourtStatus, MatchStatus, StageStatus, TournamentStatus } from '@badminton/domain';

/**
 * Read models returned by `TournamentDashboardService`.
 *
 * These are application-level DTOs, not Prisma rows: the dashboard is a derived
 * view, assembled from a bounded number of batched reads and never persisted.
 */

/** A resolved competitor name for a match participant slot. */
export interface DashboardCompetitor {
  readonly entryId: string | null;
  readonly name: string | null;
  readonly slot: number;
}

/** A match as shown on the dashboard, with enough context to render a card. */
export interface DashboardMatch {
  readonly matchId: string;
  readonly status: MatchStatus;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly stageId: string;
  readonly stageName: string;
  readonly courtId: string | null;
  readonly courtName: string | null;
  readonly courtNumber: number | null;
  readonly scheduledStartAt: Date | null;
  readonly scheduledEndAt: Date | null;
  readonly participants: readonly DashboardCompetitor[];
  readonly winnerEntryId: string | null;
}

/** A court with its current and next assigned matches. */
export interface DashboardCourt {
  readonly courtId: string;
  readonly number: number;
  readonly name: string;
  readonly status: CourtStatus;
  /** Derived, never stored: no court is "busy" in the database. */
  readonly busy: boolean;
}

/** Per-stage progress within a category. */
export interface DashboardStageProgress {
  readonly stageId: string;
  readonly name: string;
  readonly type: string;
  readonly status: StageStatus;
  readonly totalMatches: number;
  readonly completedMatches: number;
}

/** Per-category progress, aggregating its stages. */
export interface DashboardCategoryProgress {
  readonly categoryId: string;
  readonly name: string;
  readonly code: string;
  readonly totalMatches: number;
  readonly completedMatches: number;
  readonly stages: readonly DashboardStageProgress[];
}

/** Aggregate match/entry counts for the whole tournament. */
export interface DashboardSummary {
  readonly totalEntries: number;
  readonly totalMatches: number;
  readonly completedMatches: number;
  readonly inProgressMatches: number;
  readonly scheduledMatches: number;
  readonly unscheduledMatches: number;
}

/** Tournament header information for the dashboard. */
export interface DashboardTournament {
  readonly id: string;
  readonly name: string;
  readonly status: TournamentStatus;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly location: string | null;
  readonly timezone: string;
}

/**
 * The aggregated dashboard payload.
 *
 * `liveMatches`, `upcomingMatches`, `recentResults` and `unscheduledMatches`
 * are bounded slices, not the full match history, so a dashboard request stays
 * cheap regardless of how many matches a tournament has played.
 */
export interface TournamentDashboard {
  readonly tournament: DashboardTournament;
  readonly summary: DashboardSummary;
  readonly courts: readonly DashboardCourt[];
  readonly liveMatches: readonly DashboardMatch[];
  readonly upcomingMatches: readonly DashboardMatch[];
  readonly recentResults: readonly DashboardMatch[];
  readonly unscheduledMatches: readonly DashboardMatch[];
  readonly categories: readonly DashboardCategoryProgress[];
}
