import {
  buildBracketSeed,
  BusinessRuleViolationError,
  seedBracket,
  type SeededGroup,
} from '@badminton/domain';
import { describe, expect, it } from 'vitest';

/**
 * Pure bracket-seeding tests.
 *
 * These pin the draw rules the qualification path relies on: one group keeps
 * standing order, two groups cross-seed, three or more groups rank-interleave
 * then snake-fold, and byes go to the strongest qualifiers and never pair two
 * byes. No persistence and no domain services are involved.
 */

function group(groupId: string, ...entryIds: string[]): SeededGroup {
  return { groupId, entryIds };
}

describe('seedBracket', () => {
  it('keeps a single group in standing order', () => {
    expect(seedBracket([group('a', 'a1', 'a2', 'a3')])).toEqual(['a1', 'a2', 'a3']);
  });

  it('cross-seeds two groups so A1 meets Bk and B1 meets Ak', () => {
    expect(seedBracket([group('a', 'a1', 'a2'), group('b', 'b1', 'b2')])).toEqual([
      'a1',
      'b2',
      'b1',
      'a2',
    ]);
  });

  it('cross-seeds uneven two-group fields without dropping anyone', () => {
    const seeds = seedBracket([group('a', 'a1', 'a2', 'a3'), group('b', 'b1', 'b2')]);
    expect([...seeds].sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
    // Every qualifier appears exactly once.
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('rank-interleaves then snake-folds three groups', () => {
    const seeds = seedBracket([
      group('a', 'a1', 'a2'),
      group('b', 'b1', 'b2'),
      group('c', 'c1', 'c2'),
    ]);
    // Pool: a1 b1 c1 a2 b2 c2 -> folded a1 c2 b1 b2 c1 a2
    expect(seeds).toEqual(['a1', 'c2', 'b1', 'b2', 'c1', 'a2']);
  });

  it('ignores empty groups and never duplicates a qualifier', () => {
    const seeds = seedBracket([group('a', 'a1', 'a2'), group('b')]);
    expect(seeds).toEqual(['a1', 'a2']);
  });

  it('returns nothing when no group contributes', () => {
    expect(seedBracket([group('a'), group('b')])).toEqual([]);
  });
});

describe('buildBracketSeed', () => {
  it('sizes the bracket to the smallest power of two that holds every qualifier', () => {
    const result = buildBracketSeed([group('a', 'a1', 'a2'), group('b', 'b1', 'b2')]);
    expect(result.bracketSize).toBe(4);
    expect(result.byeCount).toBe(0);
    expect(result.pairings).toEqual([
      { first: 'a1', second: 'b2' },
      { first: 'b1', second: 'a2' },
    ]);
  });

  it('spreads byes to the strongest qualifiers for a six-competitor field', () => {
    const result = buildBracketSeed([
      group('a', 'a1', 'a2'),
      group('b', 'b1', 'b2'),
      group('c', 'c1', 'c2'),
    ]);

    expect(result.bracketSize).toBe(8);
    expect(result.byeCount).toBe(2);
    expect(result.pairings).toHaveLength(4);

    // Bye seeds are the strongest qualifiers, interleaved across groups.
    const byes = result.pairings.filter((pairing) => pairing.second === null);
    expect(byes.map((pairing) => pairing.first)).toEqual(['a1', 'b1']);

    // Every real competitor appears exactly once across all pairings.
    const everyone = result.pairings.flatMap((pairing) =>
      pairing.second === null ? [pairing.first] : [pairing.first, pairing.second],
    );
    expect([...everyone].sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2']);
  });

  it('never pairs two byes together', () => {
    const result = buildBracketSeed([group('a', 'a1', 'a2', 'a3', 'a4', 'a5')]);
    const byePairings = result.pairings.filter((pairing) => pairing.second === null);
    expect(byePairings.length).toBeGreaterThan(0);
    // Each bye has exactly one competitor, so a bye can never meet another bye.
    for (const pairing of result.pairings) {
      expect(pairing.first).toBeTruthy();
    }
    // No pairing is empty on both sides.
    expect(result.pairings.every((pairing) => pairing.first.length > 0)).toBe(true);
  });

  it('rejects fewer than two qualifiers', () => {
    expect(() => buildBracketSeed([group('a', 'a1')])).toThrow(BusinessRuleViolationError);
    expect(() => buildBracketSeed([])).toThrow(BusinessRuleViolationError);
  });

  it('rejects more qualifiers than the largest supported bracket', () => {
    const entries = Array.from({ length: 129 }, (_unused, index) => `e${index}`);
    expect(() => buildBracketSeed([group('a', ...entries)])).toThrow(BusinessRuleViolationError);
  });
});
