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
 * played under its round's rule (best of three, or straight set), mirroring the
 * original tournament application and the domain scoring rules.
 */
export type MatchKind = 'GROUP' | 'KNOCKOUT';

/** A knockout match's format: first to two games, or a single "straight" game. */
export type KnockoutFormat = 'best_of_3' | 'single_game';

/** One round's knockout scoring rule: match format and game points target. */
export interface KnockoutRule {
  readonly format: KnockoutFormat;
  readonly pointsPerGame: number;
}

/** The knockout round catalogue and its V1 default targets. */
export const KNOCKOUT_ROUND_KEYS = ['r128', 'r64', 'r32', 'r16', 'qf', 'sf', 'final'] as const;
export type KnockoutRoundKey = (typeof KNOCKOUT_ROUND_KEYS)[number];

const ROUND_MATCH_COUNTS: readonly { readonly key: KnockoutRoundKey; readonly matches: number }[] =
  [
    { key: 'r128', matches: 64 },
    { key: 'r64', matches: 32 },
    { key: 'r32', matches: 16 },
    { key: 'r16', matches: 8 },
    { key: 'qf', matches: 4 },
    { key: 'sf', matches: 2 },
    { key: 'final', matches: 1 },
  ];

const ROUND_DEFAULT_TARGETS: Readonly<Record<KnockoutRoundKey, number>> = {
  r128: 11,
  r64: 11,
  r32: 11,
  r16: 11,
  qf: 11,
  sf: 15,
  final: 21,
};

const ROUND_LABELS: Readonly<Record<KnockoutRoundKey, string>> = {
  r128: 'Round of 128',
  r64: 'Round of 64',
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarter-Final',
  sf: 'Semi-Final',
  final: 'Final',
};

/** Human name of a round tag (`qf` → `Quarter-Final`). */
export function knockoutRoundLabel(key: KnockoutRoundKey): string {
  return ROUND_LABELS[key];
}

/** The round tag for a bracket position (1 match is the final, 2 the semis, …). */
export function knockoutRoundKey(
  bracketSize: number,
  roundNumber: number,
): KnockoutRoundKey | undefined {
  const matchesInRound = bracketSize / 2 ** roundNumber;
  return ROUND_MATCH_COUNTS.find((round) => round.matches === matchesInRound)?.key;
}

/** The default rule for a bracket position (best of three at the round target). */
export function defaultKnockoutRule(bracketSize: number, roundNumber: number): KnockoutRule {
  const key = knockoutRoundKey(bracketSize, roundNumber);
  return { format: 'best_of_3', pointsPerGame: key ? ROUND_DEFAULT_TARGETS[key] : 21 };
}

/** The default rule for a named round tag. */
export function defaultKnockoutRuleForRound(key: KnockoutRoundKey): KnockoutRule {
  return { format: 'best_of_3', pointsPerGame: ROUND_DEFAULT_TARGETS[key] };
}

/** The round tags a bracket of `drawSize` plays, earliest first. */
export function knockoutRoundKeysForBracket(drawSize: number): readonly KnockoutRoundKey[] {
  const roundCount = Math.log2(drawSize);
  if (!Number.isInteger(roundCount) || roundCount < 1) {
    return ['qf', 'sf', 'final'];
  }
  return Array.from({ length: roundCount }, (_unused, index) =>
    knockoutRoundKey(drawSize, index + 1),
  ).filter((key): key is KnockoutRoundKey => key !== undefined);
}

/** Resolves a match's rule from its snapshot, falling back to the stage rule. */
export function resolveKnockoutRule(
  match: {
    readonly knockoutFormat: KnockoutFormat | null;
    readonly knockoutPointsPerGame: number | null;
  },
  stage: {
    readonly drawSize: number | null;
    readonly knockoutRules: Readonly<Record<string, KnockoutRule>> | null;
  } | null,
  roundNumber: number | null,
): KnockoutRule {
  if (match.knockoutFormat && match.knockoutPointsPerGame !== null) {
    return { format: match.knockoutFormat, pointsPerGame: match.knockoutPointsPerGame };
  }
  if (stage && stage.drawSize !== null && roundNumber !== null) {
    const key = knockoutRoundKey(stage.drawSize, roundNumber);
    const stored = key ? stage.knockoutRules?.[key] : undefined;
    if (stored) {
      return stored;
    }
    return defaultKnockoutRule(stage.drawSize, roundNumber);
  }
  return { format: 'best_of_3', pointsPerGame: 21 };
}

/**
 * True when a **group** game score is a legal result. This is the group-only
 * predicate (21 target, two-point margin, hard 30 ceiling); a knockout game is
 * checked by `isValidKnockoutGameScore` against its round target, which has no
 * ceiling. The two are deliberately separate so a knockout score can never be
 * rejected by the group ceiling.
 */
export function isValidGroupGameScore(points1: number, points2: number): boolean {
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

/**
 * True when a knockout game ending `points1`-`points2` respects the round's
 * target and the two-point-margin rule. A knockout game has no ceiling: it is
 * played to the target and won by two clear points (so 31-29 is legal, 30-29 is
 * not). This mirrors V1's `validateSetScore` and the domain rules.
 */
export function isValidKnockoutGameScore(
  points1: number,
  points2: number,
  target: number,
): boolean {
  if (
    !Number.isInteger(points1) ||
    !Number.isInteger(points2) ||
    points1 < 0 ||
    points2 < 0 ||
    points1 === points2
  ) {
    return false;
  }
  const higher = Math.max(points1, points2);
  return higher >= target && Math.abs(points1 - points2) >= GAME_MIN_MARGIN;
}

/** A per-game message for an illegal knockout score, or `undefined` when valid. */
export function knockoutGameScoreMessage(
  points1: number,
  points2: number,
  target: number,
  gameNumber: number,
): string | undefined {
  const label = `Game ${gameNumber}`;
  if (points1 === points2) {
    return `${label} cannot end in a tie.`;
  }
  if (isValidKnockoutGameScore(points1, points2, target)) {
    return undefined;
  }
  const higher = Math.max(points1, points2);
  if (higher < target) {
    return `${label}: the winning side must reach ${target} points.`;
  }
  return `${label}: a game must be won by at least ${GAME_MIN_MARGIN} clear points.`;
}

/** A per-game message for an illegal **group** score, or `undefined` when valid. */
export function groupGameScoreMessage(
  points1: number,
  points2: number,
  gameNumber: number,
): string | undefined {
  const label = `Game ${gameNumber}`;
  if (points1 === points2) {
    return `${label} cannot end in a tie.`;
  }
  if (isValidGroupGameScore(points1, points2)) {
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
export function analyseDraftGame(
  game: DraftGame,
  index: number,
  rule?: KnockoutRule,
): DraftGameAnalysis {
  const gameNumber = index + 1;
  const points1 = toPoints(game.participant1Points);
  const points2 = toPoints(game.participant2Points);

  if (points1 === undefined || points2 === undefined) {
    return { gameNumber, complete: false, winnerSlot: undefined, error: undefined };
  }

  const error =
    rule === undefined
      ? groupGameScoreMessage(points1, points2, gameNumber)
      : knockoutGameScoreMessage(points1, points2, rule.pointsPerGame, gameNumber);
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
 * - **GROUP** - exactly one game, decided by the higher score (21 target, 30 cap).
 * - **KNOCKOUT** - the round's rule: best of three (two or three games, first to
 *   two wins) or straight set (exactly one game), each played to the round's
 *   points target with no ceiling. When no rule is supplied the default
 *   best-of-three rule at 21 points applies.
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
  rule?: KnockoutRule,
): DraftResultAnalysis {
  if (kind === 'GROUP') {
    return analyseGroupDraft(draft);
  }
  return analyseKnockoutDraft(draft, rule ?? { format: 'best_of_3', pointsPerGame: 21 });
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

function analyseKnockoutDraft(
  draft: readonly DraftGame[],
  rule: KnockoutRule,
): DraftResultAnalysis {
  const games = draft.map((game, index) => analyseDraftGame(game, index, rule));
  const straight = rule.format === 'single_game';

  const firstError =
    games.find((game) => game.error !== undefined)?.error ??
    (games.some((game) => !game.complete) ? 'Every game needs both scores.' : undefined);

  if (firstError) {
    return { games, matchError: firstError, winnerSlot: undefined, valid: false };
  }
  if (draft.length === 0) {
    return { games, matchError: 'Enter the game score.', winnerSlot: undefined, valid: false };
  }
  if (straight) {
    if (draft.length > 1) {
      return {
        games,
        matchError: 'A straight-set match is decided by a single game.',
        winnerSlot: undefined,
        valid: false,
      };
    }
    return { games, matchError: undefined, winnerSlot: games[0]?.winnerSlot, valid: true };
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
