import { BusinessRuleViolationError } from './errors.ts';
import type { MatchSlot } from './tournament.ts';

/**
 * Pure badminton scoring rules.
 *
 * This is the single source of truth for how a game and a match are decided.
 * It has no runtime dependency and imports nothing from Prisma, Fastify or
 * React; the application and HTTP layers call it, the UI never re-implements
 * it. The database stores only validated results, so the rules are enforced in
 * the domain layer rather than as SQL.
 *
 * The game rules are shared by every match kind:
 *
 * - a game is won at 21 points with a two-point lead, extended up to a
 *   30-point ceiling (30-29 is legal, 31-29 is not);
 * - the winner is always derived from the points, never chosen.
 *
 * A match kind decides only **how many games** a completed result contains,
 * mirroring the original tournament application:
 *
 * - a **GROUP** match is a **single game** (`scoreGroupMatch`) - the original
 *   group-stage rule, a straight game to 21 with no second or third game;
 * - a **KNOCKOUT** match is **best of three** (`scoreMatchGames`): won by the
 *   first participant to win two games (2-0 or 2-1), and a result is complete
 *   only when it contains exactly the games that decided it, so a 2-0 recorded
 *   with a third game, or a 1-1 result with no decider, is rejected.
 *
 * The rules are deliberately not labelled an official federation rule set; they
 * follow the widely-used Laws of Badminton scoring and can be replaced later.
 */

/** Points required to win a game, absent the extension. */
export const GAME_POINT_TARGET = 21;

/** Hard ceiling for a single game; a game never reaches 31 points. */
export const GAME_POINT_CEILING = 30;

/** Minimum margin by which a game must be won. */
export const GAME_MIN_MARGIN = 2;

/** Fewest games a completed result can contain. */
export const MIN_GAMES_PER_MATCH = 2;

/** Most games a completed result can contain. */
export const MAX_GAMES_PER_MATCH = 3;

/** Games a participant must win to take the match. */
export const GAMES_TO_WIN_MATCH = 2;

/** A game number is 1-based and bounded by the best-of-three format. */
export const GAME_NUMBERS = [1, 2, 3] as const;
export type GameNumber = (typeof GAME_NUMBERS)[number];

/**
 * A single game as supplied by a caller. It carries the two participant slots'
 * points and the ordinal game number but no winner: the winner is always
 * derived from the points, never chosen.
 */
export interface MatchGameInput {
  readonly gameNumber: number;
  readonly participant1Points: number;
  readonly participant2Points: number;
}

/** A validated game with its derived winner. Persisted as `match_games`. */
export interface MatchGame {
  readonly gameNumber: number;
  readonly participant1Points: number;
  readonly participant2Points: number;
  readonly winnerSlot: MatchSlot;
}

/**
 * Which kind of match a result belongs to, since the format differs: a GROUP
 * match is a single game and a KNOCKOUT match is best of three.
 */
export type MatchKind = 'GROUP' | 'KNOCKOUT';

/** The outcome of a decided match, expressed in terms of the two slots. */
export interface MatchOutcome {
  readonly winnerSlot: MatchSlot;
  readonly winnerGames: number;
  readonly loserGames: number;
}

/**
 * A completed match result ready for persistence and serialization.
 *
 * `winnerEntryId`/`loserEntryId` are resolved by the application layer from the
 * match's participant slots; the scoring rules themselves only ever reason
 * about slots, so the model stays agnostic to singles and doubles.
 */
export interface MatchResult extends MatchOutcome {
  readonly matchId: string;
  readonly winnerEntryId: string;
  readonly loserEntryId: string;
  readonly games: readonly MatchGame[];
}

/** True when `points` is a whole number inside the legal game range. */
function isLegalPointValue(points: number): boolean {
  return Number.isInteger(points) && points >= 0 && points <= GAME_POINT_CEILING;
}

/**
 * True when the leading score in a game respects the scoring rules.
 *
 * A game is won by reaching 21 with a two-point lead, so the score is extended
 * while the margin stays at one (22-20, 25-23, ...). At the hard ceiling of 30
 * the next point ends the game regardless of margin, so a 30-29 win is legal;
 * a 30-30 tie and any 31-point total are not.
 */
function isValidWinningScore(higher: number, margin: number): boolean {
  if (higher >= GAME_POINT_CEILING) {
    // A game cannot pass 30, so at 30 any single-point lead wins (30-29).
    return higher === GAME_POINT_CEILING && margin >= 1;
  }
  return higher >= GAME_POINT_TARGET && margin >= GAME_MIN_MARGIN;
}

/**
 * True when a game ending `points1`–`points2` respects the scoring rules.
 */
export function isValidGameScore(points1: number, points2: number): boolean {
  if (!isLegalPointValue(points1) || !isLegalPointValue(points2)) {
    return false;
  }
  if (points1 === points2) {
    return false;
  }
  const higher = Math.max(points1, points2);
  const margin = Math.abs(points1 - points2);
  return isValidWinningScore(higher, margin);
}

/**
 * Slot that won a game. The input is assumed score-valid; callers that accept
 * untrusted points should validate first. A tie would be a programming error,
 * so it throws rather than guessing a winner.
 */
export function determineGameWinner(points1: number, points2: number): MatchSlot {
  if (points1 === points2) {
    throw new BusinessRuleViolationError('A game cannot be tied; it must have a winner.');
  }
  return points1 > points2 ? 1 : 2;
}

/** Validates a single game, throwing a `BusinessRuleViolationError`. */
export function validateGameScore(points1: number, points2: number, gameNumber: number): void {
  const label = `Game ${gameNumber}`;

  if (!isLegalPointValue(points1) || !isLegalPointValue(points2)) {
    throw new BusinessRuleViolationError(
      `${label}: points must be whole numbers between 0 and ${GAME_POINT_CEILING}.`,
    );
  }
  if (points1 === points2) {
    throw new BusinessRuleViolationError(`${label} cannot end in a tie.`);
  }

  const higher = Math.max(points1, points2);
  const margin = Math.abs(points1 - points2);

  if (isValidWinningScore(higher, margin)) {
    return;
  }

  if (higher < GAME_POINT_TARGET) {
    throw new BusinessRuleViolationError(
      `${label}: the winning participant must reach ${GAME_POINT_TARGET} points.`,
    );
  }
  if (higher === GAME_POINT_CEILING) {
    throw new BusinessRuleViolationError(
      `${label}: a game cannot exceed ${GAME_POINT_CEILING} points.`,
    );
  }
  throw new BusinessRuleViolationError(
    `${label}: a game must be won by at least ${GAME_MIN_MARGIN} points unless it reaches ${GAME_POINT_CEILING}.`,
  );
}

/** Validates the ordinal position of each game within the result. */
function validateGameNumbers(games: readonly MatchGameInput[]): void {
  games.forEach((game, index) => {
    const expected = index + 1;
    if (game.gameNumber !== expected) {
      throw new BusinessRuleViolationError(
        'Games must be numbered 1, 2, 3 in order without gaps or duplicates.',
      );
    }
  });
}

/**
 * Validates a single game and returns it with its derived `winnerSlot`.
 *
 * Shared by both match kinds so the game rules can never drift: a group match
 * and a knockout match accept exactly the same legal game scores.
 */
function scoreOneGame(game: MatchGameInput): MatchGame {
  validateGameScore(game.participant1Points, game.participant2Points, game.gameNumber);
  return {
    gameNumber: game.gameNumber,
    participant1Points: game.participant1Points,
    participant2Points: game.participant2Points,
    winnerSlot: determineGameWinner(game.participant1Points, game.participant2Points),
  };
}

/**
 * Validates and scores a **group-stage** result.
 *
 * A group match is a **single game** - the original tournament rule - so a
 * completed result must contain exactly one game and the winner is the higher
 * score. A second game is rejected rather than ignored, so a stale client can
 * never smuggle a best-of-three result into the group table.
 */
export function scoreGroupMatch(games: readonly MatchGameInput[]): readonly MatchGame[] {
  if (games.length !== 1) {
    throw new BusinessRuleViolationError(
      'A group match is a single game; submit exactly one game.',
    );
  }

  validateGameNumbers(games);

  const game = games[0] as MatchGameInput;
  return [scoreOneGame(game)];
}

/**
 * Validates and scores a **knockout** (best-of-three) result.
 *
 * Returns the games with their derived `winnerSlot`. Rejects an incomplete or
 * impossible result: fewer than two or more than three games, a game whose
 * points break the scoring rules, a third game after the match was already
 * decided, and a result that leaves the match undecided (for example 1-1).
 */
export function scoreMatchGames(games: readonly MatchGameInput[]): readonly MatchGame[] {
  if (games.length < MIN_GAMES_PER_MATCH) {
    throw new BusinessRuleViolationError(
      `A completed result must contain at least ${MIN_GAMES_PER_MATCH} games.`,
    );
  }
  if (games.length > MAX_GAMES_PER_MATCH) {
    throw new BusinessRuleViolationError(
      `A match is best of three and cannot contain more than ${MAX_GAMES_PER_MATCH} games.`,
    );
  }

  validateGameNumbers(games);

  const scored: MatchGame[] = [];
  let slot1Wins = 0;
  let slot2Wins = 0;

  for (const game of games) {
    if (slot1Wins === GAMES_TO_WIN_MATCH || slot2Wins === GAMES_TO_WIN_MATCH) {
      throw new BusinessRuleViolationError(
        'The match was already decided after two games; no further games are allowed.',
      );
    }

    const scoredGame = scoreOneGame(game);
    if (scoredGame.winnerSlot === 1) {
      slot1Wins += 1;
    } else {
      slot2Wins += 1;
    }

    scored.push(scoredGame);
  }

  if (slot1Wins !== GAMES_TO_WIN_MATCH && slot2Wins !== GAMES_TO_WIN_MATCH) {
    throw new BusinessRuleViolationError(
      `The match is not decided; one participant must win ${GAMES_TO_WIN_MATCH} games.`,
    );
  }

  return scored;
}

/**
 * Counts each slot's game wins and returns the outcome.
 *
 * Used when reading a stored result back (the games are already validated on
 * write), so it derives the winner independently of persistence.
 *
 * `kind` decides the completion rule: a GROUP match is a single game (the
 * higher score wins) and a KNOCKOUT match is best of three (a participant must
 * win two games). The default is best of three, so an omitted kind keeps the
 * knockout behaviour.
 */
export function determineMatchOutcome(
  games: readonly MatchGame[],
  kind: MatchKind = 'KNOCKOUT',
): MatchOutcome {
  let slot1Wins = 0;
  let slot2Wins = 0;

  for (const game of games) {
    if (game.winnerSlot === 1) {
      slot1Wins += 1;
    } else {
      slot2Wins += 1;
    }
  }

  if (kind === 'GROUP') {
    if (games.length !== 1) {
      throw new BusinessRuleViolationError('A group match is a single game.');
    }
    return slot1Wins === 1
      ? { winnerSlot: 1, winnerGames: 1, loserGames: 0 }
      : { winnerSlot: 2, winnerGames: 1, loserGames: 0 };
  }

  if (slot1Wins !== GAMES_TO_WIN_MATCH && slot2Wins !== GAMES_TO_WIN_MATCH) {
    throw new BusinessRuleViolationError(
      `The match is not decided; one participant must win ${GAMES_TO_WIN_MATCH} games.`,
    );
  }

  return slot1Wins === GAMES_TO_WIN_MATCH
    ? { winnerSlot: 1, winnerGames: slot1Wins, loserGames: slot2Wins }
    : { winnerSlot: 2, winnerGames: slot2Wins, loserGames: slot1Wins };
}
