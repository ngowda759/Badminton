import {
  calculateStandings,
  STANDING_GROUP_LOSS_POINTS,
  STANDING_KNOCKOUT_LOSS_POINTS,
  STANDING_WIN_POINTS,
  type MatchGame,
  type StandingsMatch,
} from '@badminton/domain';
import { describe, expect, it } from 'vitest';

/**
 * Pure group-standings tests.
 *
 * Standings are entirely derived from completed matches, so these tests assert
 * the documented calculations and the original tournament's tie-break order
 * without any persistence: points, then point difference, then points for, then
 * competitor name.
 */

function playedGame(
  gameNumber: number,
  participant1Points: number,
  participant2Points: number,
): MatchGame {
  return {
    gameNumber,
    participant1Points,
    participant2Points,
    winnerSlot: participant1Points > participant2Points ? 1 : 2,
  };
}

/** A completed knockout match won 2-0 by the slot-1 entry. */
function win(
  winnerEntryId: string,
  loserEntryId: string,
  gameScores: readonly [number, number][] = [
    [21, 15],
    [21, 18],
  ],
): StandingsMatch {
  return {
    participants: [
      { entryId: winnerEntryId, slot: 1 },
      { entryId: loserEntryId, slot: 2 },
    ],
    games: gameScores.map(([one, two], index) => playedGame(index + 1, one, two)),
    kind: 'KNOCKOUT',
  };
}

/** A single-game group match, as a GROUP stage stores it. */
function groupWin(
  winnerEntryId: string,
  loserEntryId: string,
  winnerPoints: number,
  loserPoints: number,
): StandingsMatch {
  return {
    participants: [
      { entryId: winnerEntryId, slot: 1 },
      { entryId: loserEntryId, slot: 2 },
    ],
    games: [playedGame(1, winnerPoints, loserPoints)],
    kind: 'GROUP',
  };
}

describe('calculateStandings', () => {
  it('lists every competitor on zero with no completed matches', () => {
    const rows = calculateStandings(['entry-a', 'entry-b'], []);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        played: 0,
        won: 0,
        lost: 0,
        points: 0,
        gamesWon: 0,
        gamesLost: 0,
        gameDifference: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifference: 0,
      });
    }
  });

  it('awards a group win 2 points and a group loss 0 points', () => {
    const rows = calculateStandings(
      ['entry-a', 'entry-b'],
      [groupWin('entry-a', 'entry-b', 21, 17)],
    );
    const winner = rows.find((row) => row.entryId === 'entry-a');
    const loser = rows.find((row) => row.entryId === 'entry-b');

    expect(winner).toMatchObject({
      position: 1,
      played: 1,
      won: 1,
      lost: 0,
      points: STANDING_WIN_POINTS,
      pointsFor: 21,
      pointsAgainst: 17,
      pointDifference: 4,
    });
    expect(loser).toMatchObject({
      position: 2,
      played: 1,
      won: 0,
      lost: 1,
      points: STANDING_GROUP_LOSS_POINTS,
      pointsFor: 17,
      pointsAgainst: 21,
      pointDifference: -4,
    });
  });

  it('awards a knockout loss 1 point', () => {
    const rows = calculateStandings(
      ['entry-a', 'entry-b'],
      [{ ...win('entry-a', 'entry-b'), kind: 'KNOCKOUT' }],
    );
    expect(rows.find((row) => row.entryId === 'entry-b')?.points).toBe(
      STANDING_KNOCKOUT_LOSS_POINTS,
    );
  });

  it('derives a winner and loser from one completed match', () => {
    const rows = calculateStandings(['entry-a', 'entry-b'], [win('entry-a', 'entry-b')]);
    const winner = rows.find((row) => row.entryId === 'entry-a');
    const loser = rows.find((row) => row.entryId === 'entry-b');

    expect(winner).toMatchObject({
      position: 1,
      played: 1,
      won: 1,
      lost: 0,
      points: STANDING_WIN_POINTS,
      gamesWon: 2,
      gamesLost: 0,
      gameDifference: 2,
      pointsFor: 42,
      pointsAgainst: 33,
      pointDifference: 9,
    });
    expect(loser).toMatchObject({
      position: 2,
      played: 1,
      won: 0,
      lost: 1,
      gamesWon: 0,
      gamesLost: 2,
      gameDifference: -2,
      pointsFor: 33,
      pointsAgainst: 42,
      pointDifference: -9,
    });
  });

  it('accumulates across multiple completed matches', () => {
    const rows = calculateStandings(
      ['entry-a', 'entry-b', 'entry-c'],
      [win('entry-a', 'entry-b'), win('entry-a', 'entry-c')],
    );
    expect(rows.find((row) => row.entryId === 'entry-a')).toMatchObject({
      position: 1,
      played: 2,
      won: 2,
      lost: 0,
      points: 2 * STANDING_WIN_POINTS,
    });
    expect(rows.find((row) => row.entryId === 'entry-b')).toMatchObject({
      played: 1,
      lost: 1,
    });
  });

  it('counts games and points for a 2-1 result', () => {
    const threeGames = {
      participants: [
        { entryId: 'entry-a', slot: 1 as const },
        { entryId: 'entry-b', slot: 2 as const },
      ],
      games: [playedGame(1, 21, 18), playedGame(2, 18, 21), playedGame(3, 21, 19)],
      kind: 'KNOCKOUT' as const,
    };
    const rows = calculateStandings(['entry-a', 'entry-b'], [threeGames]);
    const winner = rows.find((row) => row.entryId === 'entry-a');
    const loser = rows.find((row) => row.entryId === 'entry-b');

    expect(winner).toMatchObject({ gamesWon: 2, gamesLost: 1, gameDifference: 1 });
    expect(loser).toMatchObject({ gamesWon: 1, gamesLost: 2, gameDifference: -1 });
    // Slot-1's entry scored 21+18+21 = 60 and conceded 18+21+19 = 58.
    expect(winner).toMatchObject({ pointsFor: 60, pointsAgainst: 58, pointDifference: 2 });
    expect(loser).toMatchObject({ pointsFor: 58, pointsAgainst: 60, pointDifference: -2 });
  });

  it('orders by points first (a group win is worth more than a loss)', () => {
    const rows = calculateStandings(
      ['entry-a', 'entry-b', 'entry-c'],
      [groupWin('entry-a', 'entry-b', 21, 19), groupWin('entry-c', 'entry-b', 21, 19)],
    );
    // entry-a and entry-c each won once (2 pts); entry-b lost twice (0 pts).
    expect(rows.at(-1)?.entryId).toBe('entry-b');
    expect(rows[0]?.points).toBe(STANDING_WIN_POINTS);
  });

  it('breaks a points tie on point difference', () => {
    // Both win once; entry-a wins by more, so it leads on point difference.
    const rows = calculateStandings(
      ['entry-a', 'entry-b', 'entry-c', 'entry-d'],
      [groupWin('entry-a', 'entry-b', 21, 5), groupWin('entry-c', 'entry-d', 21, 19)],
    );
    expect(rows[0]?.entryId).toBe('entry-a');
    expect(rows[1]?.entryId).toBe('entry-c');
    expect(rows[0]?.pointDifference).toBeGreaterThan(rows[1]?.pointDifference ?? 0);
  });

  it('breaks a point-difference tie on points for', () => {
    // Equal points and equal difference (both +2), but entry-a scored more.
    const rows = calculateStandings(
      ['entry-a', 'entry-b', 'entry-c', 'entry-d'],
      [groupWin('entry-a', 'entry-b', 21, 19), groupWin('entry-c', 'entry-d', 19, 17)],
    );
    expect(rows[0]?.entryId).toBe('entry-a');
    expect(rows[1]?.entryId).toBe('entry-c');
    expect(rows[0]?.pointsFor).toBeGreaterThan(rows[1]?.pointsFor ?? 0);
  });

  it('breaks a full tie on competitor name', () => {
    const nameOf = (entryId: string): string =>
      entryId === 'entry-z' ? 'Zoe' : entryId === 'entry-a' ? 'Alice' : entryId;
    const rows = calculateStandings(['entry-z', 'entry-a'], [], nameOf);
    expect(rows.map((row) => row.entryId)).toEqual(['entry-a', 'entry-z']);
  });

  it('falls back to the entry id when no name resolver is given', () => {
    const rows = calculateStandings(['entry-z', 'entry-a'], []);
    expect(rows.map((row) => row.entryId)).toEqual(['entry-a', 'entry-z']);
  });

  it('includes an entry discovered in matches but absent from the competitor set', () => {
    const rows = calculateStandings(['entry-a'], [win('entry-a', 'entry-ghost')]);
    expect(rows.map((row) => row.entryId).sort()).toEqual(['entry-a', 'entry-ghost']);
  });
});
