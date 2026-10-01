import { determineMatchOutcome, type MatchGame, type MatchKind } from './scoring.ts';
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
 *
 * The ordering and the league points mirror the original tournament
 * application exactly (a group match is a single game, so the table is
 * `P · W · L · Pts · PF · PA · Diff`):
 *
 * 1. tournament points, descending (win = 2, loss = 0 for a group match);
 * 2. point difference (PF - PA), descending;
 * 3. points scored (PF), descending;
 * 4. competitor name, ascending (`localeCompare`, so it is locale-stable).
 *
 * The final entry-id tie-break is kept only so a full tie is still fully
 * deterministic; it never overrides the name ordering above.
 */

/** Which kind of match produced the results, since the points rule differs. */
export type { MatchKind };

/** One side of a completed match: which entry occupied which slot. */
export interface StandingsParticipant {
  readonly entryId: string;
  readonly slot: MatchSlot;
}

/**
 * The minimum a completed match must reveal to compute standings: who played
 * (with their slots) and the games that decided it. `kind` defaults to a group
 * match, which is what the group table is derived from.
 */
export interface StandingsMatch {
  readonly participants: readonly StandingsParticipant[];
  readonly games: readonly MatchGame[];
  readonly kind?: MatchKind;
}

/** Resolves an entry id to the competitor's display name, for the tie-break. */
export type StandingsNameResolver = (entryId: string) => string;

/** One competitor's line in the group table. */
export interface StandingRow {
  readonly entryId: string;
  /** Matches played (completed only). */
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  /** League points: 2 for a win and (group) 0 / (knockout) 1 for a loss. */
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

/**
 * Points awarded for a completed match.
 *
 * A win is always 2. The original tournament awarded a group-stage loss **0**
 * (a group match is a single game), while a knockout loss is recorded as 1.
 */
export const STANDING_WIN_POINTS = 2;
export const STANDING_GROUP_LOSS_POINTS = 0;
export const STANDING_KNOCKOUT_LOSS_POINTS = 1;

/** Backwards-compatible alias for the knockout loss value. */
export const STANDING_LOSS_POINTS = STANDING_KNOCKOUT_LOSS_POINTS;

function lossPointsFor(kind: MatchKind): number {
  return kind === 'GROUP' ? STANDING_GROUP_LOSS_POINTS : STANDING_KNOCKOUT_LOSS_POINTS;
}

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
 * `nameOf` resolves a competitor's name for the documented name tie-break; when
 * it is omitted the entry id is used, so the ordering stays deterministic.
 */
export function calculateStandings(
  entryIds: readonly string[],
  matches: readonly StandingsMatch[],
  nameOf?: StandingsNameResolver,
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
    const kind: MatchKind = match.kind ?? 'GROUP';
    const outcome = determineMatchOutcome(match.games, kind);
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
    loser.points += lossPointsFor(kind);

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

  const resolveName = (entryId: string): string => nameOf?.(entryId) ?? entryId;

  const ordered = [...rows.values()].sort((left, right) => {
    if (left.points !== right.points) {
      return right.points - left.points;
    }
    const leftPointDiff = left.pointsFor - left.pointsAgainst;
    const rightPointDiff = right.pointsFor - right.pointsAgainst;
    if (leftPointDiff !== rightPointDiff) {
      return rightPointDiff - leftPointDiff;
    }
    if (left.pointsFor !== right.pointsFor) {
      return right.pointsFor - left.pointsFor;
    }
    const byName = resolveName(left.entryId).localeCompare(resolveName(right.entryId));
    if (byName !== 0) {
      return byName;
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
