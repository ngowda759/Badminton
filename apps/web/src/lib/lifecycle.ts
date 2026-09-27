import {
  CATEGORY_TRANSITIONS,
  ENTRY_TRANSITIONS,
  MATCH_TRANSITIONS,
  STAGE_TRANSITIONS,
  TOURNAMENT_TRANSITIONS,
  type CategoryStatus,
  type EntryStatus,
  type MatchStatus,
  type StageStatus,
  type TournamentStatus,
} from '@badminton/domain';

/**
 * The next states reachable from the current one.
 *
 * The tables are imported from `@badminton/domain` rather than re-declared, so
 * the UI can only ever offer transitions the server itself defines. The API
 * still re-validates every transition; offering a legal-looking option that the
 * server rejects is displayed gracefully, never assumed to succeed.
 */
export const tournamentNextStatuses = (current: TournamentStatus): readonly TournamentStatus[] =>
  TOURNAMENT_TRANSITIONS[current];

export const categoryNextStatuses = (current: CategoryStatus): readonly CategoryStatus[] =>
  CATEGORY_TRANSITIONS[current];

export const stageNextStatuses = (current: StageStatus): readonly StageStatus[] =>
  STAGE_TRANSITIONS[current];

export const matchNextStatuses = (current: MatchStatus): readonly MatchStatus[] =>
  MATCH_TRANSITIONS[current];

export const entryNextStatuses = (current: EntryStatus): readonly EntryStatus[] =>
  ENTRY_TRANSITIONS[current];

/** Human-readable labels for lifecycle action buttons. */
export function transitionActionLabel(status: string): string {
  const words = status.toLowerCase().split('_');
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
