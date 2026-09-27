import {
  determineGameWinner,
  determineMatchOutcome,
  isValidGameScore,
  scoreMatchGames,
  BusinessRuleViolationError,
  type MatchGame,
  type MatchGameInput,
} from '@badminton/domain';
import { describe, expect, it } from 'vitest';

/**
 * Pure badminton scoring-rule tests.
 *
 * These exercise the single source of truth for game and match validity with no
 * database, API or UI involved. The rules are standard best-of-three: a game is
 * won at 21 with a two-point lead, extended to a hard 30 ceiling, and a match is
 * won by the first participant to take two games.
 */

function games(...scores: readonly [number, number][]): MatchGameInput[] {
  return scores.map(([participant1Points, participant2Points], index) => ({
    gameNumber: index + 1,
    participant1Points,
    participant2Points,
  }));
}

describe('isValidGameScore', () => {
  it('accepts a 21-0 win', () => {
    expect(isValidGameScore(21, 0)).toBe(true);
  });

  it('accepts a 21-19 win', () => {
    expect(isValidGameScore(21, 19)).toBe(true);
  });

  it('accepts a 22-20 extended win', () => {
    expect(isValidGameScore(22, 20)).toBe(true);
  });

  it('accepts a 30-29 win at the ceiling', () => {
    expect(isValidGameScore(30, 29)).toBe(true);
  });

  it('accepts a 30-28 win at the ceiling', () => {
    expect(isValidGameScore(30, 28)).toBe(true);
  });

  it('accepts a win regardless of which slot is higher', () => {
    expect(isValidGameScore(19, 21)).toBe(true);
  });

  it('rejects an unfinished 20-0 game', () => {
    expect(isValidGameScore(20, 0)).toBe(false);
  });

  it('rejects a 21-20 game that lacks a two-point margin', () => {
    expect(isValidGameScore(21, 20)).toBe(false);
  });

  it('rejects a 30-30 tie', () => {
    expect(isValidGameScore(30, 30)).toBe(false);
  });

  it('rejects a 31-29 game beyond the ceiling', () => {
    expect(isValidGameScore(31, 29)).toBe(false);
  });

  it('rejects negative points', () => {
    expect(isValidGameScore(-1, 21)).toBe(false);
  });

  it('rejects fractional points', () => {
    expect(isValidGameScore(21.5, 19)).toBe(false);
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

describe('scoreMatchGames', () => {
  it('accepts a 2-0 result and derives slot winners', () => {
    const scored = scoreMatchGames(games([21, 15], [21, 18]));
    expect(scored).toEqual([
      { gameNumber: 1, participant1Points: 21, participant2Points: 15, winnerSlot: 1 },
      { gameNumber: 2, participant1Points: 21, participant2Points: 18, winnerSlot: 1 },
    ]);
  });

  it('accepts a 2-1 result', () => {
    const scored = scoreMatchGames(games([21, 18], [18, 21], [21, 19]));
    expect(scored.map((game) => game.winnerSlot)).toEqual([1, 2, 1]);
  });

  it('accepts a 2-1 result where slot 2 wins the match', () => {
    const scored = scoreMatchGames(games([18, 21], [21, 18], [19, 21]));
    expect(scored.map((game) => game.winnerSlot)).toEqual([2, 1, 2]);
  });

  it('rejects a single-game result as incomplete', () => {
    expect(() => scoreMatchGames(games([21, 18]))).toThrow(BusinessRuleViolationError);
  });

  it('rejects a 1-1 result as undecided', () => {
    expect(() => scoreMatchGames(games([21, 18], [18, 21]))).toThrow(BusinessRuleViolationError);
  });

  it('rejects a third game after a 2-0 result', () => {
    expect(() => scoreMatchGames(games([21, 18], [21, 19], [21, 15]))).toThrow(
      BusinessRuleViolationError,
    );
  });

  it('rejects more than three games', () => {
    expect(() => scoreMatchGames(games([21, 18], [18, 21], [21, 18], [18, 21]))).toThrow(
      BusinessRuleViolationError,
    );
  });

  it('rejects an invalid game score inside an otherwise complete result', () => {
    expect(() => scoreMatchGames(games([21, 20], [21, 15]))).toThrow(BusinessRuleViolationError);
  });

  it('rejects a game beyond the 30-point ceiling', () => {
    expect(() => scoreMatchGames(games([31, 29], [21, 15]))).toThrow(BusinessRuleViolationError);
  });

  it('rejects out-of-order game numbers', () => {
    const outOfOrder: MatchGameInput[] = [
      { gameNumber: 2, participant1Points: 21, participant2Points: 15 },
      { gameNumber: 1, participant1Points: 21, participant2Points: 18 },
    ];
    expect(() => scoreMatchGames(outOfOrder)).toThrow(BusinessRuleViolationError);
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
