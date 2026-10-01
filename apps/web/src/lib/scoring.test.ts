import { describe, expect, it } from 'vitest';

import {
  analyseDraftGame,
  analyseDraftResult,
  groupGameScoreMessage,
  isValidGroupGameScore,
  isValidKnockoutGameScore,
  knockoutRoundKey,
  MAX_GAMES_PER_MATCH,
  resolveKnockoutRule,
} from '@/lib/scoring.ts';

describe('isValidGroupGameScore', () => {
  it.each([
    [21, 0],
    [21, 19],
    [22, 20],
    [30, 29],
    [30, 28],
    [0, 21],
  ])('accepts %i-%i', (points1, points2) => {
    expect(isValidGroupGameScore(points1, points2)).toBe(true);
  });

  it.each([
    [20, 0],
    [21, 20],
    [30, 30],
    [31, 29],
    [20, 20],
  ])('rejects %i-%i', (points1, points2) => {
    expect(isValidGroupGameScore(points1, points2)).toBe(false);
  });

  it('rejects a tie', () => {
    expect(groupGameScoreMessage(18, 18, 2)).toMatch(/tie/i);
  });
});

describe('analyseDraftGame', () => {
  it('derives the winner from the higher score', () => {
    expect(
      analyseDraftGame({ participant1Points: '21', participant2Points: '18' }, 0),
    ).toMatchObject({ gameNumber: 1, complete: true, winnerSlot: 1, error: undefined });
    expect(
      analyseDraftGame({ participant1Points: '18', participant2Points: '21' }, 1),
    ).toMatchObject({ gameNumber: 2, complete: true, winnerSlot: 2 });
  });

  it('flags an incomplete game', () => {
    expect(analyseDraftGame({ participant1Points: '', participant2Points: '18' }, 0).complete).toBe(
      false,
    );
  });

  it('flags an invalid score', () => {
    const analysis = analyseDraftGame({ participant1Points: '20', participant2Points: '18' }, 0);
    expect(analysis.error).toBeTruthy();
    expect(analysis.winnerSlot).toBeUndefined();
  });
});

describe('analyseDraftResult', () => {
  const game = (a: string, b: string) => ({ participant1Points: a, participant2Points: b });

  it('accepts a 2-0 result and picks slot 1', () => {
    const analysis = analyseDraftResult([game('21', '15'), game('21', '18')]);
    expect(analysis.valid).toBe(true);
    expect(analysis.winnerSlot).toBe(1);
  });

  it('accepts a 2-1 result and picks the winner', () => {
    const analysis = analyseDraftResult([game('21', '18'), game('18', '21'), game('21', '19')]);
    expect(analysis.valid).toBe(true);
    expect(analysis.winnerSlot).toBe(1);
  });

  it('rejects a third game after the match is decided', () => {
    const analysis = analyseDraftResult([game('21', '18'), game('21', '19'), game('21', '15')]);
    expect(analysis.valid).toBe(false);
    expect(analysis.matchError).toBeTruthy();
  });

  it('rejects an undecided 1-1 result', () => {
    const analysis = analyseDraftResult([game('21', '18'), game('18', '21')]);
    expect(analysis.valid).toBe(false);
    expect(analysis.winnerSlot).toBeUndefined();
  });

  it('rejects an incomplete single-game result', () => {
    const analysis = analyseDraftResult([game('21', '18')]);
    expect(analysis.valid).toBe(false);
  });

  it('exposes the best-of-three ceiling', () => {
    expect(MAX_GAMES_PER_MATCH).toBe(3);
  });
});

describe('isValidKnockoutGameScore', () => {
  it('validates against the round target with no ceiling', () => {
    expect(isValidKnockoutGameScore(15, 12, 15)).toBe(true);
    expect(isValidKnockoutGameScore(14, 15, 15)).toBe(false);
    expect(isValidKnockoutGameScore(15, 14, 15)).toBe(false);
    expect(isValidKnockoutGameScore(31, 29, 21)).toBe(true);
    expect(isValidKnockoutGameScore(30, 29, 21)).toBe(false);
  });
});

describe('analyseDraftResult (knockout rule)', () => {
  const game = (a: string, b: string) => ({ participant1Points: a, participant2Points: b });
  const bestOfThree = { format: 'best_of_3' as const, pointsPerGame: 15 };

  it('validates each game against the round target', () => {
    const analysis = analyseDraftResult(
      [game('15', '12'), game('15', '13')],
      'KNOCKOUT',
      bestOfThree,
    );
    expect(analysis.valid).toBe(true);
    expect(analysis.winnerSlot).toBe(1);
  });

  it('flags a game below the round target', () => {
    const analysis = analyseDraftResult(
      [game('14', '12'), game('15', '13')],
      'KNOCKOUT',
      bestOfThree,
    );
    expect(analysis.valid).toBe(false);
    expect(analysis.matchError).toBeTruthy();
  });

  it('accepts a straight-set single game', () => {
    const analysis = analyseDraftResult([game('11', '5')], 'KNOCKOUT', {
      format: 'single_game',
      pointsPerGame: 11,
    });
    expect(analysis.valid).toBe(true);
    expect(analysis.winnerSlot).toBe(1);
  });

  it('rejects a second game in a straight-set match', () => {
    const analysis = analyseDraftResult([game('11', '5'), game('11', '6')], 'KNOCKOUT', {
      format: 'single_game',
      pointsPerGame: 11,
    });
    expect(analysis.valid).toBe(false);
  });
});

describe('knockoutRoundKey', () => {
  it('maps bracket positions to round tags', () => {
    expect(knockoutRoundKey(8, 1)).toBe('qf');
    expect(knockoutRoundKey(8, 3)).toBe('final');
    expect(knockoutRoundKey(16, 1)).toBe('r16');
  });
});

describe('resolveKnockoutRule', () => {
  const stage = {
    drawSize: 8,
    knockoutRules: { qf: { format: 'single_game' as const, pointsPerGame: 11 } },
  };

  it('prefers the match snapshot', () => {
    const rule = resolveKnockoutRule(
      { knockoutFormat: 'best_of_3', knockoutPointsPerGame: 21 },
      stage,
      1,
    );
    expect(rule).toEqual({ format: 'best_of_3', pointsPerGame: 21 });
  });

  it('falls back to the stage rule for the bracket position', () => {
    const rule = resolveKnockoutRule(
      { knockoutFormat: null, knockoutPointsPerGame: null },
      stage,
      1,
    );
    expect(rule).toEqual({ format: 'single_game', pointsPerGame: 11 });
  });

  it('falls back to the default when no rule is configured', () => {
    const rule = resolveKnockoutRule(
      { knockoutFormat: null, knockoutPointsPerGame: null },
      { drawSize: 8, knockoutRules: null },
      3,
    );
    expect(rule).toEqual({ format: 'best_of_3', pointsPerGame: 21 });
  });
});
