import type { Match } from './tournament.ts';

/**
 * Pure result-correction predicate.
 *
 * A recorded result is normally immutable: a completed match cannot be scored a
 * second time. The original tournament application, however, lets an operator
 * re-enter a mistyped group score (`saveGroupScore`), and the TASK-5 parity
 * audit records the missing workflow as gap G6. This module is the single
 * source of truth for *what* may be corrected; the application service owns the
 * transactional re-scoring.
 *
 * The scope is deliberately **group-only**. Correcting a knockout result also
 * requires re-deriving the bracket (clearing the winner from the next round and
 * un-completing every downstream match), which is a separate workflow; a
 * knockout match therefore stays immutable. A knockout match is identified by
 * its derived bracket position - a non-null `roundNumber`/`matchNumber` - never
 * by a stored flag, mirroring `isBracketFinalMatch` and the rest of the
 * derived-structure idiom. It has no runtime dependency.
 */

/**
 * True exactly when a match's result may be corrected: it is `COMPLETED` and it
 * is a group match (no bracket position). Any non-completed match - scheduled,
 * in progress or cancelled - has no recorded result to correct, and a completed
 * knockout match cannot be corrected without re-deriving the bracket.
 */
export function isMatchCorrectable(match: Match): boolean {
  return match.status === 'COMPLETED' && match.roundNumber === null && match.matchNumber === null;
}
