import type { MatchStatus } from '@badminton/domain';

/**
 * Whether a match's recorded result can be corrected from the UI.
 *
 * Mirrors the domain rule (`isMatchCorrectable`) for immediate feedback: only a
 * `COMPLETED` match has a result to correct, for either a group or a knockout
 * stage. The API stays authoritative - a correction of a match the server
 * considers uncorrectable is rejected with a business-rule violation - so this
 * predicate only decides whether the control is offered.
 */
export function isResultCorrectable(status: MatchStatus): boolean {
  return status === 'COMPLETED';
}
