import {
  determineGameWinner,
  determineKnockoutOutcome,
  determineMatchOutcome,
  isValidGroupGameScore,
  isValidKnockoutGameScore,
  knockoutRoundKey,
  normalizeKnockoutRules,
  scoreGroupMatch,
  scoreKnockoutMatch,
  validateGroupGameScore,
  validateKnockoutGameScore,
  validateKnockoutRule,
  BusinessRuleViolationError,
  type MatchGame,
  type MatchGameInput,
} from '@badminton/domain';
import { describe, expect, it } from 'vitest';

/**
 * Pure badminton scoring-rule tests.
 *
 * These exercise the single source of truth for game and match validity with no
 * database, API or UI involved. GROUP and KNOCKOUT use **separate** game
 * validators: a group game is won at 21 with a two-point lead up to a hard
 * 30-point ceiling, while a knockout game is played to its round's target with a
 * two-point lead and **no ceiling**. The match kind decides how many games
 * decide it: a GROUP match is a single game and a KNOCKOUT match follows its
 * round's rule (best of three, or a single "straight set" game).
 */

function games(...scores: readonly [number, number][]): MatchGameInput[] {
  return scores.map(([participant1Points, participant2Points], index) => ({
    gameNumber: index + 1,
    participant1Points,
    participant2Points,
  }));
}

describe('isValidGroupGameScore', () => {
  it.each([
    [21, 19],
    [30, 29],
    [30, 28],
    [22, 20],
    [19, 21],
  ])('accepts a legal group game %i-%i', (points1, points2) => {
    expect(isValidGroupGameScore(points1, points2)).toBe(true);
  });

  it.each([
    [31, 29],
    [21, 20],
    [20, 19],
    [30, 30],
    [20, 0],
    [-1, 21],
    [21.5, 19],
  ])('rejects an illegal group game %i-%i', (points1, points2) => {
    expect(isValidGroupGameScore(points1, points2)).toBe(false);
  });
});

describe('validateGroupGameScore', () => {
  it('accepts a legal group game and rejects a 31-29 game beyond the ceiling', () => {
    expect(() => {
      validateGroupGameScore(30, 29, 1);
    }).not.toThrow();
    expect(() => {
      validateGroupGameScore(31, 29, 1);
    }).toThrow(BusinessRuleViolationError);
  });

  it('rejects a one-point margin at the target', () => {
    expect(() => {
      validateGroupGameScore(21, 20, 1);
    }).toThrow(BusinessRuleViolationError);
  });
});

describe('determineGameWinner', () => {
  it('returns slot 1 when slot 1 has more points', () => {
    expect(determineGameWinner(21, 18)).toBe(1);
  });

  it('returns slot 2 when slot 2 has more points', () => {
    expect(determineGameWinner(18, 21)).toBe(2);
  });

  it('throws on a tie', () => {
    expect(() => determineGameWinner(20, 20)).toThrow(BusinessRuleViolationError);
  });
});

describe('scoreGroupMatch', () => {
  it('accepts a single game and derives the winner from the higher score', () => {
    expect(scoreGroupMatch(games([21, 17]))).toEqual([
      { gameNumber: 1, participant1Points: 21, participant2Points: 17, winnerSlot: 1 },
    ]);
  });

  it('accepts a single game won by slot 2', () => {
    expect(scoreGroupMatch(games([17, 21]))[0]?.winnerSlot).toBe(2);
  });

  it('accepts an extended single game at the ceiling', () => {
    expect(scoreGroupMatch(games([30, 29]))[0]?.winnerSlot).toBe(1);
  });

  it('rejects a second game', () => {
    expect(() => scoreGroupMatch(games([21, 17], [21, 18]))).toThrow(BusinessRuleViolationError);
  });

  it('rejects a best-of-three result outright', () => {
    expect(() => scoreGroupMatch(games([21, 18], [18, 21], [21, 19]))).toThrow(
      BusinessRuleViolationError,
    );
  });

  it('rejects a single game that is not won to 21 with a two-point lead', () => {
    expect(() => scoreGroupMatch(games([19, 17]))).toThrow(BusinessRuleViolationError);
    expect(() => scoreGroupMatch(games([21, 20]))).toThrow(BusinessRuleViolationError);
  });

  it('rejects a single-game tie', () => {
    expect(() => scoreGroupMatch(games([21, 21]))).toThrow(BusinessRuleViolationError);
  });

  it('rejects an empty result', () => {
    expect(() => scoreGroupMatch([])).toThrow(BusinessRuleViolationError);
  });
});

describe('scoreKnockoutMatch best of three (target 21)', () => {
  const bestOfThree = { format: 'best_of_3' as const, pointsPerGame: 21 };

  it('accepts a 2-0 result and derives slot winners', () => {
    const scored = scoreKnockoutMatch(games([21, 15], [21, 18]), bestOfThree);
    expect(scored).toEqual([
      { gameNumber: 1, participant1Points: 21, participant2Points: 15, winnerSlot: 1 },
      { gameNumber: 2, participant1Points: 21, participant2Points: 18, winnerSlot: 1 },
    ]);
  });

  it('accepts a 2-1 result', () => {
    const scored = scoreKnockoutMatch(games([21, 18], [18, 21], [21, 19]), bestOfThree);
    expect(scored.map((game) => game.winnerSlot)).toEqual([1, 2, 1]);
  });

  it('accepts a 2-1 result where slot 2 wins the match', () => {
    const scored = scoreKnockoutMatch(games([18, 21], [21, 18], [19, 21]), bestOfThree);
    expect(scored.map((game) => game.winnerSlot)).toEqual([2, 1, 2]);
  });

  it('accepts a deciding game past 30 (no knockout ceiling)', () => {
    const scored = scoreKnockoutMatch(games([21, 15], [15, 21], [31, 29]), bestOfThree);
    expect(scored.map((game) => game.winnerSlot)).toEqual([1, 2, 1]);
  });

  it('rejects a single-game result as incomplete', () => {
    expect(() => scoreKnockoutMatch(games([21, 18]), bestOfThree)).toThrow(
      BusinessRuleViolationError,
    );
  });

  it('rejects a 1-1 result as undecided', () => {
    expect(() => scoreKnockoutMatch(games([21, 18], [18, 21]), bestOfThree)).toThrow(
      BusinessRuleViolationError,
    );
  });

  it('rejects a third game after a 2-0 result', () => {
    expect(() => scoreKnockoutMatch(games([21, 18], [21, 19], [21, 15]), bestOfThree)).toThrow(
      BusinessRuleViolationError,
    );
  });

  it('rejects more than three games', () => {
    expect(() =>
      scoreKnockoutMatch(games([21, 18], [18, 21], [21, 18], [18, 21]), bestOfThree),
    ).toThrow(BusinessRuleViolationError);
  });

  it('rejects an invalid game score inside an otherwise complete result', () => {
    expect(() => scoreKnockoutMatch(games([21, 20], [21, 15]), bestOfThree)).toThrow(
      BusinessRuleViolationError,
    );
  });

  it('rejects out-of-order game numbers', () => {
    const outOfOrder: MatchGameInput[] = [
      { gameNumber: 2, participant1Points: 21, participant2Points: 15 },
      { gameNumber: 1, participant1Points: 21, participant2Points: 18 },
    ];
    expect(() => scoreKnockoutMatch(outOfOrder, bestOfThree)).toThrow(BusinessRuleViolationError);
  });
});

describe('determineMatchOutcome', () => {
  const stored = (winnerSlots: readonly (1 | 2)[]): readonly MatchGame[] =>
    winnerSlots.map((winnerSlot, index) => ({
      gameNumber: index + 1,
      participant1Points: winnerSlot === 1 ? 21 : 15,
      participant2Points: winnerSlot === 2 ? 21 : 15,
      winnerSlot,
    }));

  it('awards a 2-0 match to slot 1', () => {
    expect(determineMatchOutcome(stored([1, 1]))).toEqual({
      winnerSlot: 1,
      winnerGames: 2,
      loserGames: 0,
    });
  });

  it('awards a 2-1 match to slot 2', () => {
    expect(determineMatchOutcome(stored([1, 2, 2]))).toEqual({
      winnerSlot: 2,
      winnerGames: 2,
      loserGames: 1,
    });
  });

  it('throws when no participant has two wins', () => {
    expect(() => determineMatchOutcome(stored([1, 2]))).toThrow(BusinessRuleViolationError);
  });
});

describe('isValidKnockoutGameScore', () => {
  it.each([
    [21, 19],
    [22, 20],
    [30, 28],
    [31, 29],
    [19, 21],
  ])('accepts a legal game at target 21: %i-%i', (points1, points2) => {
    expect(isValidKnockoutGameScore(points1, points2, 21)).toBe(true);
  });

  it.each([
    [30, 29],
    [21, 20],
    [20, 15],
  ])('rejects an illegal game at target 21: %i-%i', (points1, points2) => {
    expect(isValidKnockoutGameScore(points1, points2, 21)).toBe(false);
  });

  it.each([
    [11, 9],
    [12, 10],
    [31, 29],
  ])('accepts a legal game at target 11: %i-%i', (points1, points2) => {
    expect(isValidKnockoutGameScore(points1, points2, 11)).toBe(true);
  });

  it('rejects an illegal game at target 11 (one-point margin)', () => {
    expect(isValidKnockoutGameScore(11, 10, 11)).toBe(false);
  });

  it.each([
    [30, 28],
    [31, 29],
  ])('accepts a legal game at target 30: %i-%i', (points1, points2) => {
    expect(isValidKnockoutGameScore(points1, points2, 30)).toBe(true);
  });

  it('rejects a one-point margin at target 30', () => {
    expect(isValidKnockoutGameScore(30, 29, 30)).toBe(false);
  });

  it('rejects a tie, fractional points and a game short of the target', () => {
    expect(isValidKnockoutGameScore(21, 21, 21)).toBe(false);
    expect(isValidKnockoutGameScore(21.5, 15, 21)).toBe(false);
    expect(isValidKnockoutGameScore(10, 5, 11)).toBe(false);
  });
});

describe('validateKnockoutGameScore', () => {
  it('accepts a 31-29 game past the group ceiling', () => {
    expect(() => {
      validateKnockoutGameScore(31, 29, 21);
    }).not.toThrow();
  });

  it('rejects a one-point margin and a game short of the target', () => {
    expect(() => {
      validateKnockoutGameScore(30, 29, 30);
    }).toThrow(BusinessRuleViolationError);
    expect(() => {
      validateKnockoutGameScore(20, 15, 21);
    }).toThrow(BusinessRuleViolationError);
  });
});

describe('validateKnockoutRule', () => {
  it('accepts a known format and an in-range target', () => {
    expect(validateKnockoutRule({ format: 'best_of_3', pointsPerGame: 21 })).toBeNull();
    expect(validateKnockoutRule({ format: 'single_game', pointsPerGame: 11 })).toBeNull();
  });

  it('rejects an unknown format', () => {
    expect(validateKnockoutRule({ format: 'best_of_5', pointsPerGame: 21 })).toBeTruthy();
  });

  it('rejects a target outside 1-99 or non-whole', () => {
    expect(validateKnockoutRule({ format: 'best_of_3', pointsPerGame: 0 })).toBeTruthy();
    expect(validateKnockoutRule({ format: 'best_of_3', pointsPerGame: 100 })).toBeTruthy();
    expect(validateKnockoutRule({ format: 'best_of_3', pointsPerGame: 21.5 })).toBeTruthy();
  });

  it('rejects a non-object rule', () => {
    expect(validateKnockoutRule(null)).toBeTruthy();
    expect(validateKnockoutRule('qf')).toBeTruthy();
  });
});

describe('normalizeKnockoutRules', () => {
  it('fills every round from the defaults when nothing is stored', () => {
    const rules = normalizeKnockoutRules(null);
    expect(rules.qf).toEqual({ format: 'best_of_3', pointsPerGame: 11 });
    expect(rules.sf).toEqual({ format: 'best_of_3', pointsPerGame: 15 });
    expect(rules.final).toEqual({ format: 'best_of_3', pointsPerGame: 21 });
  });

  it('keeps a valid override and drops a malformed one', () => {
    const rules = normalizeKnockoutRules({
      final: { format: 'single_game', pointsPerGame: 30 },
      sf: { format: 'nonsense', pointsPerGame: 15 },
    });
    expect(rules.final).toEqual({ format: 'single_game', pointsPerGame: 30 });
    expect(rules.sf).toEqual({ format: 'best_of_3', pointsPerGame: 15 });
  });
});

describe('knockoutRoundKey', () => {
  it.each([
    [8, 1, 'qf'],
    [8, 2, 'sf'],
    [8, 3, 'final'],
    [16, 1, 'r16'],
    [32, 1, 'r32'],
    [64, 1, 'r64'],
    [128, 1, 'r128'],
  ])('maps a %i-entry bracket round %i to %s', (size, round, key) => {
    expect(knockoutRoundKey(size, round)).toBe(key);
  });

  it('throws for a round outside the bracket', () => {
    expect(() => knockoutRoundKey(8, 4)).toThrow(BusinessRuleViolationError);
  });
});

describe('scoreKnockoutMatch', () => {
  const bestOfThree = { format: 'best_of_3' as const, pointsPerGame: 15 };
  const straight = { format: 'single_game' as const, pointsPerGame: 11 };

  it('accepts a best-of-three result at the round target', () => {
    const scored = scoreKnockoutMatch(games([15, 10], [15, 13]), bestOfThree);
    expect(scored.map((game) => game.winnerSlot)).toEqual([1, 1]);
  });

  it('rejects a best-of-three game won by one point at the target', () => {
    expect(() => scoreKnockoutMatch(games([15, 14], [15, 10]), bestOfThree)).toThrow(
      BusinessRuleViolationError,
    );
  });

  it('accepts a deciding game past 30 at the target', () => {
    expect(() =>
      scoreKnockoutMatch(games([15, 10], [10, 15], [31, 29]), bestOfThree),
    ).not.toThrow();
  });

  it('accepts a straight-set single game at target 11', () => {
    const scored = scoreKnockoutMatch(games([11, 9]), straight);
    expect(scored).toHaveLength(1);
    expect(scored[0]?.winnerSlot).toBe(1);
  });

  it('accepts a straight-set game past 30 (no ceiling) at target 11', () => {
    expect(() => scoreKnockoutMatch(games([31, 29]), straight)).not.toThrow();
  });

  it('rejects a straight-set game won by only one point', () => {
    expect(() => scoreKnockoutMatch(games([11, 10]), straight)).toThrow(BusinessRuleViolationError);
  });

  it('rejects a second game in a straight-set match', () => {
    expect(() => scoreKnockoutMatch(games([11, 5], [11, 6]), straight)).toThrow(
      BusinessRuleViolationError,
    );
  });
});

describe('determineKnockoutOutcome', () => {
  it('awards a straight-set match to the single-game winner', () => {
    const outcome = determineKnockoutOutcome(
      [{ gameNumber: 1, participant1Points: 11, participant2Points: 5, winnerSlot: 1 }],
      { format: 'single_game', pointsPerGame: 11 },
    );
    expect(outcome).toEqual({ winnerSlot: 1, winnerGames: 1, loserGames: 0 });
  });
});
