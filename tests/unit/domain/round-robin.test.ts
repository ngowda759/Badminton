import {
  BusinessRuleViolationError,
  roundRobinMatchCount,
  roundRobinPairings,
  roundRobinRounds,
} from '@badminton/domain';
import { describe, expect, it } from 'vitest';

/**
 * Pure round-robin group scheduling.
 *
 * These tests pin the structure the group-fixture service relies on: a complete
 * round-robin where every competitor plays every other competitor exactly once,
 * with no self-matches, no duplicate pairings and byes never emitted as matches.
 */

/** Asserts that `competitors` produce a valid complete round-robin. */
function assertCompleteRoundRobin(competitors: readonly string[]): void {
  const pairings = roundRobinPairings(competitors);
  const expected = (competitors.length * (competitors.length - 1)) / 2;
  expect(pairings).toHaveLength(expected);

  const seen = new Set<string>();
  const played = new Map<string, number>();
  for (const [first, second] of pairings) {
    expect(first).not.toBe(second);
    const key = [first, second].sort().join('|');
    expect(seen.has(key)).toBe(false);
    seen.add(key);
    played.set(first, (played.get(first) ?? 0) + 1);
    played.set(second, (played.get(second) ?? 0) + 1);
  }

  for (const competitor of competitors) {
    expect(played.get(competitor)).toBe(competitors.length - 1);
  }
}

describe('roundRobinMatchCount', () => {
  it('is n(n-1)/2', () => {
    expect(roundRobinMatchCount(2)).toBe(1);
    expect(roundRobinMatchCount(3)).toBe(3);
    expect(roundRobinMatchCount(4)).toBe(6);
    expect(roundRobinMatchCount(5)).toBe(10);
    expect(roundRobinMatchCount(6)).toBe(15);
  });

  it('rejects fewer than two competitors', () => {
    expect(() => roundRobinMatchCount(1)).toThrow(BusinessRuleViolationError);
    expect(() => roundRobinMatchCount(0)).toThrow(BusinessRuleViolationError);
  });
});

describe('roundRobinRounds', () => {
  it('produces one match for two competitors', () => {
    const rounds = roundRobinRounds(['a', 'b']);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.pairings).toHaveLength(1);
  });

  it('produces a complete round-robin for an even group', () => {
    for (const size of [2, 4, 6, 8]) {
      const competitors = Array.from({ length: size }, (_, index) => `c${String(index)}`);
      assertCompleteRoundRobin(competitors);
      const rounds = roundRobinRounds(competitors);
      expect(rounds).toHaveLength(size - 1);
      // No byes: every round is full for an even group.
      for (const round of rounds) {
        expect(round.pairings).toHaveLength(size / 2);
      }
    }
  });

  it('produces a complete round-robin for an odd group with one bye per round', () => {
    for (const size of [3, 5, 7]) {
      const competitors = Array.from({ length: size }, (_, index) => `c${String(index)}`);
      assertCompleteRoundRobin(competitors);
      const rounds = roundRobinRounds(competitors);
      // An odd group plays `size` rounds; exactly one competitor sits out each.
      expect(rounds).toHaveLength(size);
      for (const round of rounds) {
        expect(round.pairings).toHaveLength((size - 1) / 2);
      }
    }
  });

  it('never emits a self-match or a duplicate pairing', () => {
    const rounds = roundRobinRounds(['a', 'b', 'c', 'd', 'e']);
    const seen = new Set<string>();
    for (const round of rounds) {
      for (const [first, second] of round.pairings) {
        expect(first).not.toBe(second);
        const key = [first, second].sort().join('|');
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('numbers rounds from one', () => {
    const rounds = roundRobinRounds(['a', 'b', 'c', 'd']);
    expect(rounds.map((round) => round.roundNumber)).toEqual([1, 2, 3]);
  });

  it('is deterministic for a given ordering', () => {
    const first = roundRobinPairings(['a', 'b', 'c', 'd']);
    const second = roundRobinPairings(['a', 'b', 'c', 'd']);
    expect(second).toEqual(first);
  });

  it('rejects fewer than two competitors', () => {
    expect(() => roundRobinRounds(['a'])).toThrow(BusinessRuleViolationError);
    expect(() => roundRobinRounds([])).toThrow(BusinessRuleViolationError);
  });
});
