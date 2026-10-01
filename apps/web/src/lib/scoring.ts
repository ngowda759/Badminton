/**
 * Client-side badminton scoring checks for immediate feedback.
 *
 * This mirrors the rules in `@badminton/domain` so the operator sees a problem
 * while typing, but it is *only* feedback: the API re-validates through the
 * real domain functions and remains authoritative. Keep this deliberately
 * small and in sync with the domain constants; it never decides a result.
 */

export const GAME_POINT_TARGET = 21;
export const GAME_POINT_CEILING = 30;
export const GAME_MIN_MARGIN = 2;
export const MAX_GAMES_PER_MATCH = 3;

/**
 * The two match kinds. A GROUP match is a single game and a KNOCKOUT match is
 * best of three, mirroring the original tournament application and the domain
 * scoring rules.
 */
export type MatchKind = 'GROUP' | 'KNOCKOUT';

/** True when a game score is a legal badminton result. */
export function isValidGameScore(points1: number, points2: number): boolean {
  if (
    !Number.isInteger(points1) ||
    !Number.isInteger(points2) ||
    points1 < 0 ||
    points2 < 0 ||
    points1 > GAME_POINT_CEILING ||
    points2 > GAME_POINT_CEILING ||
    points1 === points2
  ) {
    return false;
  }
  const higher = Math.max(points1, points2);
  const margin = Math.abs(points1 - points2);
  if (higher >= GAME_POINT_CEILING) {
    return higher === GAME_POINT_CEILING && margin >= 1;
  }
  return higher >= GAME_POINT_TARGET && margin >= GAME_MIN_MARGIN;
}

/** A per-game message for an illegal score, or `undefined` when valid. */
export function gameScoreMessage(
  points1: number,
  points2: number,
  gameNumber: number,
): string | undefined {
  const label = `Game ${gameNumber}`;
  if (points1 === points2) {
    return `${label} cannot end in a tie.`;
  }
  if (isValidGameScore(points1, points2)) {
    return undefined;
  }
  const higher = Math.max(points1, points2);
  if (higher < GAME_POINT_TARGET) {
    return `${label}: the winning side must reach ${GAME_POINT_TARGET} points.`;
  }
  if (higher > GAME_POINT_CEILING) {
    return `${label}: a game cannot exceed ${GAME_POINT_CEILING} points.`;
  }
  return `${label}: a game must be won by at least ${GAME_MIN_MARGIN} points unless it reaches ${GAME_POINT_CEILING}.`;
}

export interface DraftGame {
  readonly participant1Points: string;
  readonly participant2Points: string;
}

export interface DraftGameAnalysis {
  readonly gameNumber: number;
  readonly complete: boolean;
  /** Winning slot derived from the points, or `undefined` when undecided. */
  readonly winnerSlot: 1 | 2 | undefined;
  readonly error: string | undefined;
}

function toPoints(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Analyses one draft game, deriving its winner when the score is valid. */
export function analyseDraftGame(game: DraftGame, index: number): DraftGameAnalysis {
  const gameNumber = index + 1;
  const points1 = toPoints(game.participant1Points);
  const points2 = toPoints(game.participant2Points);

  if (points1 === undefined || points2 === undefined) {
    return { gameNumber, complete: false, winnerSlot: undefined, error: undefined };
  }

  const error = gameScoreMessage(points1, points2, gameNumber);
  if (error) {
    return { gameNumber, complete: true, winnerSlot: undefined, error };
  }
  return {
    gameNumber,
    complete: true,
    winnerSlot: points1 > points2 ? 1 : 2,
    error: undefined,
  };
}

/**
 * Validates a whole draft result.
 *
 * The rules depend on the match kind:
 *
 * - **GROUP** - exactly one game, decided by the higher score.
 * - **KNOCKOUT** - best of three: no more than three games, no third game
 *   after a 2-0, and a side that has won two games.
 */
export interface DraftResultAnalysis {
  readonly games: readonly DraftGameAnalysis[];
  readonly matchError: string | undefined;
  readonly winnerSlot: 1 | 2 | undefined;
  readonly valid: boolean;
}

export function analyseDraftResult(
  draft: readonly DraftGame[],
  kind: MatchKind = 'KNOCKOUT',
): DraftResultAnalysis {
  if (kind === 'GROUP') {
    return analyseGroupDraft(draft);
  }
  return analyseKnockoutDraft(draft);
}

/** A group match is a single game; a second game is rejected, not ignored. */
function analyseGroupDraft(draft: readonly DraftGame[]): DraftResultAnalysis {
  const games = draft.map((game, index) => analyseDraftGame(game, index));
  const firstGame = games[0];

  if (firstGame?.error) {
    return { games, matchError: firstGame.error, winnerSlot: undefined, valid: false };
  }
  if (draft.length !== 1) {
    return {
      games,
      matchError: 'A group match is a single game; submit exactly one game.',
      winnerSlot: undefined,
      valid: false,
    };
  }
  if (!firstGame?.complete) {
    return {
      games,
      matchError: 'Enter the game score.',
      winnerSlot: undefined,
      valid: false,
    };
  }
  return { games, matchError: undefined, winnerSlot: firstGame.winnerSlot, valid: true };
}

function analyseKnockoutDraft(draft: readonly DraftGame[]): DraftResultAnalysis {
  const games = draft.map((game, index) => analyseDraftGame(game, index));

  const firstError =
    games.find((game) => game.error !== undefined)?.error ??
    (games.some((game) => !game.complete) ? 'Every game needs both scores.' : undefined);

  if (firstError) {
    return { games, matchError: firstError, winnerSlot: undefined, valid: false };
  }
  if (draft.length < 2) {
    return {
      games,
      matchError: 'A completed result needs at least two games.',
      winnerSlot: undefined,
      valid: false,
    };
  }
  if (draft.length > MAX_GAMES_PER_MATCH) {
    return {
      games,
      matchError: `A match is best of three and cannot contain more than ${MAX_GAMES_PER_MATCH} games.`,
      winnerSlot: undefined,
      valid: false,
    };
  }

  let slot1Wins = 0;
  let slot2Wins = 0;
  for (const game of games) {
    if (slot1Wins === 2 || slot2Wins === 2) {
      return {
        games,
        matchError: 'The match was already decided after two games; remove the extra game.',
        winnerSlot: undefined,
        valid: false,
      };
    }
    if (game.winnerSlot === 1) {
      slot1Wins += 1;
    } else {
      slot2Wins += 1;
    }
  }

  if (slot1Wins !== 2 && slot2Wins !== 2) {
    return {
      games,
      matchError: 'The match is not decided; one side must win two games.',
      winnerSlot: undefined,
      valid: false,
    };
  }

  return {
    games,
    matchError: undefined,
    winnerSlot: slot1Wins === 2 ? 1 : 2,
    valid: true,
  };
}
