import { determineMatchOutcome, type MatchGame } from './scoring.ts';
import type { MatchSlot } from './tournament.ts';

/**
 * Group standings derived from completed match results.
 *
 * Standings are **never stored**: they are recomputed from the completed
 * results whenever they are read, so the table can never drift from the
 * matches. This module is pure and depends only on the scoring rules.
 *
 * Only completed matches are passed in; a scheduled or in-progress match
 * contributes nothing, which is why a stage with no completed matches yields
 * every competitor on zero.
 */

/** One side of a completed match: which entry occupied which slot. */
export interface StandingsParticipant {
  readonly entryId: string;
  readonly slot: MatchSlot;
}

/**
 * The minimum a completed match must reveal to compute standings: who played
 * (with their slots) and the games that decided it.
 */
export interface StandingsMatch {
  readonly participants: readonly StandingsParticipant[];
  readonly games: readonly MatchGame[];
}

/** One competitor's line in the group table. */
export interface StandingRow {
  readonly entryId: string;
  /** Matches played (completed only). */
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  /** League points: 2 for a win, 1 for a loss, 0 when nothing is played. */
  readonly points: number;
  readonly gamesWon: number;
  readonly gamesLost: number;
  readonly gameDifference: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly pointDifference: number;
  /** 1-based position under the documented tie-break order. */
  readonly position: number;
}

interface MutableRow {
  entryId: string;
  played: number;
  won: number;
  lost: number;
  points: number;
  gamesWon: number;
  gamesLost: number;
  pointsFor: number;
  pointsAgainst: number;
}

/** Points awarded for winning and losing a completed group match. */
export const STANDING_WIN_POINTS = 2;
export const STANDING_LOSS_POINTS = 1;

function emptyRow(entryId: string): MutableRow {
  return {
    entryId,
    played: 0,
    won: 0,
    lost: 0,
    points: 0,
    gamesWon: 0,
    gamesLost: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  };
}

function entryIdForSlot(participants: readonly StandingsParticipant[], slot: MatchSlot): string {
  const participant = participants.find((candidate) => candidate.slot === slot);
  if (!participant) {
    throw new Error(`Completed match is missing slot ${slot}.`);
  }
  return participant.entryId;
}

/**
 * Computes the group table.
 *
 * `entryIds` is the competitor set (every entry that belongs to the group), so
 * an entry with no completed match still appears with a zero row. Any entry
 * discovered in `matches` but absent from `entryIds` is included defensively.
 *
 * Ordering is deterministic and documented:
 *
 * 1. matches won, descending;
 * 2. game difference, descending;
 * 3. point difference, descending;
 * 4. entry id ascending, as a stable final tie-break.
 *
 * This is a deliberate, simple ordering, not an official federation rule.
 */
export function calculateStandings(
  entryIds: readonly string[],
  matches: readonly StandingsMatch[],
): readonly StandingRow[] {
  const rows = new Map<string, MutableRow>();

  const ensure = (entryId: string): MutableRow => {
    let row = rows.get(entryId);
    if (!row) {
      row = emptyRow(entryId);
      rows.set(entryId, row);
    }
    return row;
  };

  for (const entryId of entryIds) {
    ensure(entryId);
  }

  for (const match of matches) {
    const outcome = determineMatchOutcome(match.games);
    const winnerSlot = outcome.winnerSlot;
    const loserSlot: MatchSlot = winnerSlot === 1 ? 2 : 1;
    const winnerEntryId = entryIdForSlot(match.participants, winnerSlot);
    const loserEntryId = entryIdForSlot(match.participants, loserSlot);

    const winner = ensure(winnerEntryId);
    const loser = ensure(loserEntryId);

    winner.played += 1;
    winner.won += 1;
    winner.points += STANDING_WIN_POINTS;
    loser.played += 1;
    loser.lost += 1;
    loser.points += STANDING_LOSS_POINTS;

    for (const game of match.games) {
      // Points belong to the slot, not to whoever won the game: slot 1's entry
      // always scores `participant1Points`. Distribute per slot so a 2-1 result
      // credits the match winner's lost game to the opponent correctly.
      const slot1Entry = ensure(entryIdForSlot(match.participants, 1));
      const slot2Entry = ensure(entryIdForSlot(match.participants, 2));

      if (game.winnerSlot === 1) {
        slot1Entry.gamesWon += 1;
        slot2Entry.gamesLost += 1;
      } else {
        slot2Entry.gamesWon += 1;
        slot1Entry.gamesLost += 1;
      }

      slot1Entry.pointsFor += game.participant1Points;
      slot1Entry.pointsAgainst += game.participant2Points;
      slot2Entry.pointsFor += game.participant2Points;
      slot2Entry.pointsAgainst += game.participant1Points;
    }
  }

  const ordered = [...rows.values()].sort((left, right) => {
    if (left.won !== right.won) {
      return right.won - left.won;
    }
    const leftGameDiff = left.gamesWon - left.gamesLost;
    const rightGameDiff = right.gamesWon - right.gamesLost;
    if (leftGameDiff !== rightGameDiff) {
      return rightGameDiff - leftGameDiff;
    }
    const leftPointDiff = left.pointsFor - left.pointsAgainst;
    const rightPointDiff = right.pointsFor - right.pointsAgainst;
    if (leftPointDiff !== rightPointDiff) {
      return rightPointDiff - leftPointDiff;
    }
    return left.entryId < right.entryId ? -1 : left.entryId > right.entryId ? 1 : 0;
  });

  return ordered.map((row, index) => ({
    entryId: row.entryId,
    played: row.played,
    won: row.won,
    lost: row.lost,
    points: row.points,
    gamesWon: row.gamesWon,
    gamesLost: row.gamesLost,
    gameDifference: row.gamesWon - row.gamesLost,
    pointsFor: row.pointsFor,
    pointsAgainst: row.pointsAgainst,
    pointDifference: row.pointsFor - row.pointsAgainst,
    position: index + 1,
  }));
}
