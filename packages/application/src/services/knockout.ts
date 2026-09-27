import type { MatchSlot, MatchStatus, StageStatus } from '@badminton/domain';

/**
 * Read models returned by the knockout services.
 *
 * These are application-level DTOs, not Prisma rows: they describe a bracket in
 * the shape the REST API and the UI need, without exposing persistence types.
 */

/** One participant slot of a knockout match; `entryId` is `null` until filled. */
export interface BracketParticipant {
  readonly slot: MatchSlot;
  readonly entryId: string | null;
}

/** One match in a knockout bracket. */
export interface BracketMatch {
  readonly matchId: string;
  readonly matchNumber: number;
  readonly sequence: number;
  readonly status: MatchStatus;
  readonly participant1: BracketParticipant;
  readonly participant2: BracketParticipant;
  /** Winner entry, or `null` while the match is unresolved. */
  readonly winnerEntryId: string | null;
}

/** One round of a knockout bracket. */
export interface BracketRound {
  readonly roundNumber: number;
  readonly name: string;
  readonly matches: readonly BracketMatch[];
}

/** The full bracket for a KNOCKOUT stage. */
export interface Bracket {
  readonly stageId: string;
  readonly stageName: string;
  readonly status: StageStatus;
  readonly bracketSize: number;
  readonly roundCount: number;
  readonly rounds: readonly BracketRound[];
  /** True once the final is completed (a champion exists). */
  readonly complete: boolean;
}
