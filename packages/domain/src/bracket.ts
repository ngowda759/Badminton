import { BusinessRuleViolationError } from './errors.ts';
import type { MatchSlot } from './tournament.ts';

/**
 * Pure single-elimination bracket maths.
 *
 * Phase 6 stores a bracket implicitly in the existing `matches` table: each
 * knockout match carries a `roundNumber`, a `matchNumber` and a stage-unique
 * `sequence`, and its `MatchParticipant` rows fill slots 1 and 2. This module
 * is the single source of truth for the derived structure - how many rounds a
 * bracket of a given size has, which matches make up a round, how a match maps
 * onto its place in the next round, and what a round is called. It has no
 * runtime dependency and knows nothing about Prisma or HTTP.
 *
 * Round 1 is the first round played; round `roundCount` is the final. Within a
 * round, matches are numbered `1..matchesInRound` in bracket order (match 1 is
 * the top of the bracket), so "the winner of match X plays in match
 * ceil(X / 2) of the next round" holds for every supported size.
 */

/** The only bracket sizes Phase 6 accepts - a power of two no larger than 128. */
export const SUPPORTED_BRACKET_SIZES = [2, 4, 8, 16, 32, 64, 128] as const;
export type BracketSize = (typeof SUPPORTED_BRACKET_SIZES)[number];

/** True when `size` is a supported single-elimination bracket size. */
export function isSupportedBracketSize(size: number): size is BracketSize {
  return (SUPPORTED_BRACKET_SIZES as readonly number[]).includes(size);
}

function requireSupportedSize(size: number): BracketSize {
  if (!isSupportedBracketSize(size)) {
    throw new BusinessRuleViolationError(
      `Bracket size ${size} is not supported; use a power of two from 2 to 128.`,
    );
  }
  return size;
}

/** Number of rounds in a bracket of `size` (log2 of the size). */
export function calculateRoundCount(size: number): number {
  return Math.log2(requireSupportedSize(size));
}

/** Number of matches played in `roundNumber` of a bracket of `size`. */
export function calculateMatchesInRound(size: number, roundNumber: number): number {
  const roundCount = calculateRoundCount(size);
  if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > roundCount) {
    throw new BusinessRuleViolationError(
      `Round ${roundNumber} is outside a ${size}-entry bracket (1-${roundCount}).`,
    );
  }
  return size / 2 ** roundNumber;
}

/** Total number of matches in a bracket of `size` (size - 1). */
export function calculateTotalMatches(size: number): number {
  return requireSupportedSize(size) - 1;
}

/** The round that follows `roundNumber` (one greater). */
export function calculateNextRoundNumber(roundNumber: number): number {
  requirePositiveInteger(roundNumber, 'roundNumber');
  return roundNumber + 1;
}

/** The match in the next round that receives the winner of `matchNumber`. */
export function calculateNextMatchNumber(matchNumber: number): number {
  requirePositiveInteger(matchNumber, 'matchNumber');
  return Math.floor((matchNumber - 1) / 2) + 1;
}

/** The slot the winner of `matchNumber` fills in the next-round match. */
export function calculateNextSlot(matchNumber: number): MatchSlot {
  requirePositiveInteger(matchNumber, 'matchNumber');
  // Odd match numbers (the top half of a pair) feed slot 1; even feed slot 2.
  return matchNumber % 2 === 1 ? 1 : 2;
}

/** Where the winner of a bracket match is placed next. */
export interface NextBracketPosition {
  readonly roundNumber: number;
  readonly matchNumber: number;
  readonly slot: MatchSlot;
}

/** Derives the destination of the winner of a match, from its round/number. */
export function calculateNextBracketPosition(
  roundNumber: number,
  matchNumber: number,
): NextBracketPosition {
  return {
    roundNumber: calculateNextRoundNumber(roundNumber),
    matchNumber: calculateNextMatchNumber(matchNumber),
    slot: calculateNextSlot(matchNumber),
  };
}

/**
 * Stage-unique sequence for a bracket match.
 *
 * Sequence is a display/storage ordering: rounds are laid out consecutively,
 * so round 1 occupies the first `matchesInRound(1)` values and the final holds
 * the last. It is contiguous and stable for a bracket size, which keeps
 * `unique(stageId, sequence)` satisfied without exposing the encoded layout to
 * callers.
 */
export function calculateSequence(size: number, roundNumber: number, matchNumber: number): number {
  const matchesInRound = calculateMatchesInRound(size, roundNumber);
  requirePositiveInteger(matchNumber, 'matchNumber');
  if (matchNumber > matchesInRound) {
    throw new BusinessRuleViolationError(
      `Match ${matchNumber} is outside round ${roundNumber} of a ${size}-entry bracket.`,
    );
  }

  let sequence = 0;
  for (let round = 1; round < roundNumber; round += 1) {
    sequence += calculateMatchesInRound(size, round);
  }
  return sequence + matchNumber;
}

/** Display name of a round: Final, Semifinals, Quarterfinals, Round of N. */
export function bracketRoundName(size: number, roundNumber: number): string {
  const roundCount = calculateRoundCount(size);
  if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > roundCount) {
    throw new BusinessRuleViolationError(
      `Round ${roundNumber} is outside a ${size}-entry bracket (1-${roundCount}).`,
    );
  }

  const roundsFromFinal = roundCount - roundNumber;
  if (roundsFromFinal === 0) {
    return 'Final';
  }
  if (roundsFromFinal === 1) {
    return 'Semifinals';
  }
  if (roundsFromFinal === 2) {
    return 'Quarterfinals';
  }
  return `Round of ${calculateMatchesInRound(size, roundNumber) * 2}`;
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new BusinessRuleViolationError(`${field} must be a positive whole number.`);
  }
}
