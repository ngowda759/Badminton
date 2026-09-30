import { BusinessRuleViolationError } from './errors.ts';

/**
 * Pure group-stage round-robin scheduling.
 *
 * A `GROUP` stage's fixtures are a complete round-robin: every competitor plays
 * every other competitor exactly once, so a group of `n` competitors produces
 * exactly `n * (n - 1) / 2` matches. This module is the single source of truth
 * for that structure - it knows nothing about entries, Prisma or HTTP, and it
 * deliberately computes only the pairing, never the participants' identities.
 *
 * The pairings come from the circle method: fix the first competitor and rotate
 * the rest one position per round. It is the same deterministic algorithm the
 * original tournament app used, so the same roster always produces the same
 * fixtures. An odd group gets a bye each round, and a bye is never emitted as a
 * match - only real pairings are returned.
 */

/** The smallest group a round-robin can be generated for. */
export const MIN_ROUND_ROBIN_COMPETITORS = 2;

/** Number of matches a complete round-robin of `n` competitors contains. */
export function roundRobinMatchCount(competitorCount: number): number {
  if (!Number.isInteger(competitorCount) || competitorCount < MIN_ROUND_ROBIN_COMPETITORS) {
    throw new BusinessRuleViolationError(
      `A round-robin needs at least ${MIN_ROUND_ROBIN_COMPETITORS} competitors.`,
    );
  }
  return (competitorCount * (competitorCount - 1)) / 2;
}

/**
 * One round of a round-robin: the pairs that can play simultaneously.
 *
 * `roundNumber` is 1-based and, for an odd group, a competitor simply sits out
 * that round. The pairing itself is what callers persist; a round is only a
 * presentation grouping.
 */
export interface RoundRobinRound<T> {
  readonly roundNumber: number;
  readonly pairings: readonly (readonly [T, T])[];
}

/**
 * Builds the complete round-robin schedule for `competitors`.
 *
 * The competitor order is preserved: the first item is fixed and the rest
 * rotate, so the result is deterministic for a given input order. Returns one
 * `RoundRobinRound` per round (`n - 1` rounds for `n` competitors, or `n` when
 * `n` is odd because of the bye), each holding only real pairings.
 */
export function roundRobinRounds<T>(competitors: readonly T[]): readonly RoundRobinRound<T>[] {
  if (competitors.length < MIN_ROUND_ROBIN_COMPETITORS) {
    throw new BusinessRuleViolationError(
      `A round-robin needs at least ${MIN_ROUND_ROBIN_COMPETITORS} competitors.`,
    );
  }

  // A bye is represented by an absent competitor rather than a sentinel value,
  // so the generic item type never has to admit `null`.
  const rotation: (T | undefined)[] = [...competitors];
  if (rotation.length % 2 === 1) {
    rotation.push(undefined);
  }

  const size = rotation.length;
  const rounds: RoundRobinRound<T>[] = [];

  for (let roundIndex = 0; roundIndex < size - 1; roundIndex += 1) {
    const pairings: (readonly [T, T])[] = [];

    for (let index = 0; index < size / 2; index += 1) {
      const first = rotation[index];
      const second = rotation[size - 1 - index];
      if (first !== undefined && second !== undefined) {
        pairings.push([first, second]);
      }
    }

    rounds.push({ roundNumber: roundIndex + 1, pairings });

    // Rotate every competitor but the fixed first one by one position. The
    // popped value may be the bye, and it must rotate too, so it is spliced back
    // unconditionally.
    const last = rotation.pop();
    rotation.splice(1, 0, last);
  }

  return rounds;
}

/** The flat list of pairings across every round, in generation order. */
export function roundRobinPairings<T>(competitors: readonly T[]): readonly (readonly [T, T])[] {
  return roundRobinRounds(competitors).flatMap((round) => round.pairings);
}
