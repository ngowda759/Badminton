import {
  calculateStandings,
  STANDING_LOSS_POINTS,
  STANDING_WIN_POINTS,
  type MatchGame,
  type StandingsMatch,
} from '@badminton/domain';
import { describe, expect, it } from 'vitest';

/**
 * Pure group-standings tests.
 *
 * Standings are entirely derived from completed matches, so these tests assert
 * the documented calculations and tie-break order without any persistence.
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

/** A completed match won 2-0 by the slot-1 entry. */
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
      points: STANDING_LOSS_POINTS,
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

  it('orders by match wins first', () => {
    const rows = calculateStandings(
      ['entry-a', 'entry-b', 'entry-c'],
      [win('entry-a', 'entry-b'), win('entry-c', 'entry-b')],
    );
    // entry-a and entry-c both have one win; entry-b has none and sorts last.
    expect(rows.at(-1)?.entryId).toBe('entry-b');
  });

  it('breaks a wins tie on game difference', () => {
    // Both win one match, but entry-a wins 2-0 while entry-c drops a game.
    const close: StandingsMatch = {
      participants: [
        { entryId: 'entry-c', slot: 1 },
        { entryId: 'entry-d', slot: 2 },
      ],
      games: [playedGame(1, 21, 18), playedGame(2, 18, 21), playedGame(3, 21, 19)],
    };
    const rows = calculateStandings(
      ['entry-a', 'entry-b', 'entry-c', 'entry-d'],
      [win('entry-a', 'entry-b'), close],
    );
    expect(rows[0]?.entryId).toBe('entry-a');
    expect(rows[0]?.gameDifference).toBeGreaterThan(rows[1]?.gameDifference ?? 0);
  });

  it('breaks a game-difference tie on point difference', () => {
    // Both 2-0 wins, so game difference is equal; entry-a has the wider margin.
    const rows = calculateStandings(
      ['entry-a', 'entry-b', 'entry-c', 'entry-d'],
      [
        win('entry-a', 'entry-b', [
          [21, 10],
          [21, 10],
        ]),
        win('entry-c', 'entry-d', [
          [21, 19],
          [21, 19],
        ]),
      ],
    );
    expect(rows[0]?.entryId).toBe('entry-a');
    expect(rows[1]?.entryId).toBe('entry-c');
  });

  it('breaks a full tie deterministically on entry id', () => {
    const rows = calculateStandings(['entry-z', 'entry-a'], []);
    expect(rows.map((row) => row.entryId)).toEqual(['entry-a', 'entry-z']);
  });

  it('includes an entry discovered in matches but absent from the competitor set', () => {
    const rows = calculateStandings(['entry-a'], [win('entry-a', 'entry-ghost')]);
    expect(rows.map((row) => row.entryId).sort()).toEqual(['entry-a', 'entry-ghost']);
  });
});
