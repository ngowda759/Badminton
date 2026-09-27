import { describe, expect, it } from 'vitest';

import {
  analyseDraftGame,
  analyseDraftResult,
  gameScoreMessage,
  isValidGameScore,
  MAX_GAMES_PER_MATCH,
} from '@/lib/scoring.ts';

describe('isValidGameScore', () => {
  it.each([
    [21, 0],
    [21, 19],
    [22, 20],
    [30, 29],
    [30, 28],
    [0, 21],
  ])('accepts %i-%i', (points1, points2) => {
    expect(isValidGameScore(points1, points2)).toBe(true);
  });

  it.each([
    [20, 0],
    [21, 20],
    [30, 30],
    [31, 29],
    [20, 20],
  ])('rejects %i-%i', (points1, points2) => {
    expect(isValidGameScore(points1, points2)).toBe(false);
  });

  it('rejects a tie', () => {
    expect(gameScoreMessage(18, 18, 2)).toMatch(/tie/i);
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
