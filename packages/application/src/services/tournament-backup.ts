import type {
  Court,
  Match,
  MatchParticipant,
  Tournament,
  TournamentCategory,
  TournamentEntry,
  TournamentStage,
} from '@badminton/domain';

import type { MatchGameWithMatch } from '../repositories/data.ts';

/**
 * A whole-tournament JSON backup.
 *
 * Export is a pure read: the aggregate rows are assembled from the existing
 * per-tournament repository reads in one derived value, so a mis-created or
 * abandoned tournament can be snapshotted before a destructive change. It
 * deliberately carries the domain rows (which serialise to ISO dates) rather
 * than a second read model.
 */
export interface TournamentBackup {
  readonly tournament: Tournament;
  readonly categories: readonly TournamentCategory[];
  readonly stages: readonly TournamentStage[];
  readonly courts: readonly Court[];
  readonly entries: readonly TournamentEntry[];
  readonly matches: readonly Match[];
  readonly participants: readonly MatchParticipant[];
  readonly games: readonly MatchGameWithMatch[];
}

/**
 * The outcome of a tournament reset.
 *
 * Reset keeps the setup and clears only results, schedules and stage status, so
 * the summary reports what actually changed (and both counts are `0` on an
 * idempotent second reset).
 */
export interface TournamentResetSummary {
  readonly tournamentId: string;
  readonly matchesReset: number;
  readonly stagesReopened: number;
}
