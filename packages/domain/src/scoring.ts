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
 * The game rules differ by match kind and are kept in **separate validators**,
 * never shared through one generic entry point:
 *
 * - a **GROUP** game (`validateGroupGameScore`) is a single game won at 21
 *   points with a two-point lead, extended up to a hard 30-point ceiling
 *   (30-29 is legal, 31-29 is not);
 * - a **KNOCKOUT** game (`validateKnockoutGameScore`) is played to the round's
 *   configured target with the same two-point lead but **no ceiling**, so a
 *   31-29 game is legal;
 * - the winner is always derived from the points, never chosen.
 *
 * A match kind decides only **how many games** a completed result contains,
 * mirroring the original tournament application:
 *
 * - a **GROUP** match is a **single game** (`scoreGroupMatch`) - the original
 *   group-stage rule, a straight game to 21 with no second or third game;
 * - a **KNOCKOUT** match is played under its round's rule (`scoreKnockoutMatch`):
 *   **best of three** by default, or a single "straight set" game when the round
 *   is configured that way; a best-of-three match is won by the first participant
 *   to win two games (2-0 or 2-1), and a result is complete only when it contains
 *   exactly the games that decided it, so a 2-0 recorded with a third game, or a
 *   1-1 result with no decider, is rejected.
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

/**
 * Per-round knockout scoring configuration.
 *
 * A knockout match's format and points target are configured per round before
 * the knockout is started and snapshotted onto the match when the bracket is
 * generated, so a later settings change never rewrites a live match. The shape
 * mirrors the original tournament application exactly: a round's rule is a
 * `{ format, pointsPerGame }` pair, where the format is `best_of_3` (first to
 * two games) or `single_game` ("Straight set", one game).
 */
export const KNOCKOUT_MATCH_FORMATS = ['best_of_3', 'single_game'] as const;
export type KnockoutMatchFormat = (typeof KNOCKOUT_MATCH_FORMATS)[number];

/** One round's scoring rule: the match format and the game points target. */
export interface MatchScoringRule {
  readonly format: KnockoutMatchFormat;
  readonly pointsPerGame: number;
}

/** Legal bounds for a configured points target (V1: `MIN/MAX_POINTS_PER_GAME`). */
export const MIN_POINTS_PER_GAME = 1;
export const MAX_POINTS_PER_GAME = 99;

/**
 * Slack above a round's target that a knockout game may reach.
 *
 * A knockout game has no absolute ceiling (V1's `validateSetScore`), but the
 * points are still whole numbers. The target plus this extension bounds the
 * legal range generously while keeping the check finite.
 */
export const MAX_KNOCKOUT_EXTENSION = MAX_POINTS_PER_GAME;

/**
 * The knockout round catalogue, keyed by the round tag the original tournament
 * uses. The default points targets preserve V1's behaviour: R32/R16/QF 11,
 * SF 15, Final 21. Larger rounds (V2 supports a 128-entry bracket) default to 11
 * like the other early rounds.
 */
export const KNOCKOUT_ROUND_KEYS = ['r128', 'r64', 'r32', 'r16', 'qf', 'sf', 'final'] as const;
export type KnockoutRoundKey = (typeof KNOCKOUT_ROUND_KEYS)[number];

interface KnockoutRoundDefinition {
  readonly key: KnockoutRoundKey;
  readonly name: string;
  /** Matches this round plays in the bracket (final = 1, semifinals = 2, …). */
  readonly matchesInRound: number;
  readonly target: number;
}

const KNOCKOUT_ROUND_DEFINITIONS: readonly KnockoutRoundDefinition[] = [
  { key: 'r128', name: 'Round of 128', matchesInRound: 64, target: 11 },
  { key: 'r64', name: 'Round of 64', matchesInRound: 32, target: 11 },
  { key: 'r32', name: 'Round of 32', matchesInRound: 16, target: 11 },
  { key: 'r16', name: 'Round of 16', matchesInRound: 8, target: 11 },
  { key: 'qf', name: 'Quarter-Final', matchesInRound: 4, target: 11 },
  { key: 'sf', name: 'Semi-Final', matchesInRound: 2, target: 15 },
  { key: 'final', name: 'Final', matchesInRound: 1, target: 21 },
];

const ROUND_DEFINITION_BY_KEY = new Map(
  KNOCKOUT_ROUND_DEFINITIONS.map((definition) => [definition.key, definition]),
);
const ROUND_DEFINITION_BY_MATCH_COUNT = new Map(
  KNOCKOUT_ROUND_DEFINITIONS.map((definition) => [definition.matchesInRound, definition]),
);

/** Human name of a round tag (`qf` → `Quarter-Final`). */
export function knockoutRoundName(key: KnockoutRoundKey): string {
  return ROUND_DEFINITION_BY_KEY.get(key)?.name ?? key;
}

/**
 * The round tag for a position in a bracket.
 *
 * Derived from how many matches the round plays, so it is correct for every
 * supported size: 1 match is the final, 2 the semifinals, 4 the quarterfinals,
 * 8 the round of 16, and so on. This is the single mapping from V2's generic
 * bracket maths to V1's `QF`/`SF`/`Final` round keys.
 */
export function knockoutRoundKey(bracketSize: number, roundNumber: number): KnockoutRoundKey {
  const roundCount = Math.log2(bracketSize);
  if (!Number.isInteger(roundCount) || roundNumber < 1 || roundNumber > roundCount) {
    throw new BusinessRuleViolationError(
      `Round ${roundNumber} is outside a ${bracketSize}-entry bracket.`,
    );
  }
  const matchesInRound = bracketSize / 2 ** roundNumber;
  const definition = ROUND_DEFINITION_BY_MATCH_COUNT.get(matchesInRound);
  if (!definition) {
    throw new BusinessRuleViolationError(
      `No knockout round is defined for ${matchesInRound} matches.`,
    );
  }
  return definition.key;
}

/** Every round's default rule, keyed by round tag (V1's `DEFAULT_KNOCKOUT_RULES`). */
export const DEFAULT_KNOCKOUT_ROUND_RULES: Readonly<Record<KnockoutRoundKey, MatchScoringRule>> =
  Object.freeze(
    Object.fromEntries(
      KNOCKOUT_ROUND_DEFINITIONS.map((definition) => [
        definition.key,
        { format: 'best_of_3' as const, pointsPerGame: definition.target },
      ]),
    ) as Record<KnockoutRoundKey, MatchScoringRule>,
  );

/** A fresh, mutable copy of the default per-round rules. */
export function defaultKnockoutRules(): Record<KnockoutRoundKey, MatchScoringRule> {
  return Object.fromEntries(
    KNOCKOUT_ROUND_KEYS.map((key) => {
      const rule = DEFAULT_KNOCKOUT_ROUND_RULES[key];
      return [key, { format: rule.format, pointsPerGame: rule.pointsPerGame }];
    }),
  ) as Record<KnockoutRoundKey, MatchScoringRule>;
}

/**
 * Validates a single round's rule, returning a safe message or `null`.
 *
 * Mirrors V1's `validateKnockoutRule`: the format must be a known one and the
 * target a whole number in `[1, 99]`. A malformed rule never reaches the
 * scoring engine - it is rejected here or normalized back to the default.
 */
export function validateKnockoutRule(rule: unknown): string | null {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    return 'A knockout scoring rule must be an object.';
  }
  const candidate = rule as { format?: unknown; pointsPerGame?: unknown };
  if (!KNOCKOUT_MATCH_FORMATS.includes(candidate.format as KnockoutMatchFormat)) {
    return 'Match format must be Best of 3 or Straight set.';
  }
  const points = candidate.pointsPerGame;
  if (
    typeof points !== 'number' ||
    !Number.isFinite(points) ||
    !Number.isInteger(points) ||
    points < MIN_POINTS_PER_GAME ||
    points > MAX_POINTS_PER_GAME
  ) {
    return `Points per game must be a whole number between ${MIN_POINTS_PER_GAME} and ${MAX_POINTS_PER_GAME}.`;
  }
  return null;
}

/**
 * Fills missing rounds from the defaults and drops malformed entries.
 *
 * Used both by migration (a stage without `knockoutRules` gains the defaults) and
 * by the settings setter, so an unknown or corrupted round never breaks scoring.
 */
export function normalizeKnockoutRules(raw: unknown): Record<KnockoutRoundKey, MatchScoringRule> {
  const normalized = defaultKnockoutRules();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return normalized;
  }
  const source = raw as Record<string, unknown>;
  for (const key of KNOCKOUT_ROUND_KEYS) {
    const value = source[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const candidate = value as { format?: unknown; pointsPerGame?: unknown };
    const rule: MatchScoringRule = {
      format: candidate.format as KnockoutMatchFormat,
      pointsPerGame: candidate.pointsPerGame as number,
    };
    if (validateKnockoutRule(rule)) {
      continue;
    }
    normalized[key] = rule;
  }
  return normalized;
}

/**
 * The rule a round is configured with, falling back to its default when the
 * round is unknown or its stored rule is malformed (V1's `knockoutRuleFor`).
 */
export function knockoutRuleFor(
  rules: Readonly<Record<string, MatchScoringRule>> | null | undefined,
  roundKey: KnockoutRoundKey,
): MatchScoringRule {
  const stored = rules?.[roundKey];
  if (stored && !validateKnockoutRule(stored)) {
    return { format: stored.format, pointsPerGame: stored.pointsPerGame };
  }
  const fallback = DEFAULT_KNOCKOUT_ROUND_RULES[roundKey];
  return { format: fallback.format, pointsPerGame: fallback.pointsPerGame };
}

/** The configured rule for a bracket position, resolved from the stage's rules. */
export function knockoutMatchRule(
  rules: Readonly<Record<string, MatchScoringRule>> | null | undefined,
  bracketSize: number,
  roundNumber: number,
): MatchScoringRule {
  return knockoutRuleFor(rules, knockoutRoundKey(bracketSize, roundNumber));
}

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

/** True when `points` is a non-negative whole number. */
function isNonNegativeInteger(points: number): boolean {
  return Number.isInteger(points) && points >= 0;
}

/** True when `points` is a whole number inside the legal **group** game range. */
function isLegalGroupPointValue(points: number): boolean {
  return isNonNegativeInteger(points) && points <= GAME_POINT_CEILING;
}

/**
 * True when the leading score in a **group** game respects the scoring rules.
 *
 * A group game is won by reaching 21 with a two-point lead, so the score is
 * extended while the margin stays at one (22-20, 25-23, ...). At the hard
 * ceiling of 30 the next point ends the game regardless of margin, so a 30-29
 * win is legal; a 30-30 tie and any 31-point total are not.
 */
function isValidGroupWinningScore(higher: number, margin: number): boolean {
  if (higher >= GAME_POINT_CEILING) {
    // A group game cannot pass 30, so at 30 any single-point lead wins (30-29).
    return higher === GAME_POINT_CEILING && margin >= 1;
  }
  return higher >= GAME_POINT_TARGET && margin >= GAME_MIN_MARGIN;
}

/**
 * True when a **group** game ending `points1`–`points2` respects the group
 * rules. This is the group-only predicate; a knockout game is checked by
 * `isValidKnockoutGameScore` against its round target, which has no ceiling.
 */
export function isValidGroupGameScore(points1: number, points2: number): boolean {
  if (!isLegalGroupPointValue(points1) || !isLegalGroupPointValue(points2)) {
    return false;
  }
  if (points1 === points2) {
    return false;
  }
  const higher = Math.max(points1, points2);
  const margin = Math.abs(points1 - points2);
  return isValidGroupWinningScore(higher, margin);
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

/**
 * Validates a single **group** game, throwing a `BusinessRuleViolationError`.
 *
 * The group rule is fixed: target 21, two-point margin, hard 30-point ceiling.
 * A knockout game is validated by `validateKnockoutGameScore`, which takes the
 * round's configured target and has no ceiling; the two validators are kept
 * separate so a knockout game can never be rejected by the group ceiling.
 */
export function validateGroupGameScore(points1: number, points2: number, gameNumber: number): void {
  const label = `Game ${gameNumber}`;

  if (!isLegalGroupPointValue(points1) || !isLegalGroupPointValue(points2)) {
    throw new BusinessRuleViolationError(
      `${label}: points must be whole numbers between 0 and ${GAME_POINT_CEILING}.`,
    );
  }
  if (points1 === points2) {
    throw new BusinessRuleViolationError(`${label} cannot end in a tie.`);
  }

  const higher = Math.max(points1, points2);
  const margin = Math.abs(points1 - points2);

  if (isValidGroupWinningScore(higher, margin)) {
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
 * Validates and scores a **group-stage** result.
 *
 * A group match is a **single game** - the original tournament rule - so a
 * completed result must contain exactly one game and the winner is the higher
 * score. A second game is rejected rather than ignored, so a stale client can
 * never smuggle a best-of-three result into the group table. The game is
 * validated by the **group** validator (21 target, 30 ceiling); a knockout
 * match never comes through here.
 */
export function scoreGroupMatch(games: readonly MatchGameInput[]): readonly MatchGame[] {
  if (games.length !== 1) {
    throw new BusinessRuleViolationError(
      'A group match is a single game; submit exactly one game.',
    );
  }

  validateGameNumbers(games);

  const game = games[0] as MatchGameInput;
  validateGroupGameScore(game.participant1Points, game.participant2Points, game.gameNumber);
  return [
    {
      gameNumber: game.gameNumber,
      participant1Points: game.participant1Points,
      participant2Points: game.participant2Points,
      winnerSlot: determineGameWinner(game.participant1Points, game.participant2Points),
    },
  ];
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

/* ------------------------------------------------------------------ */
/* Rule-aware knockout scoring (per-round format + target)             */
/* ------------------------------------------------------------------ */

/**
 * True when `points` is a whole number inside the legal knockout game range.
 *
 * A knockout game has no ceiling: it is played to the round's target and won by
 * two clear points, extended for as long as the margin stays at one (a 31-29
 * game is legal when the target is 30). This mirrors V1's `validateSetScore`
 * and is deliberately different from a group game's 30-point cap.
 */
function isLegalKnockoutPointValue(points: number, target: number): boolean {
  return isNonNegativeInteger(points) && points <= target + MAX_KNOCKOUT_EXTENSION;
}

/**
 * True when a knockout game ending `points1`-`points2` respects the round's
 * target and the two-point-margin rule.
 */
export function isValidKnockoutGameScore(
  points1: number,
  points2: number,
  target: number,
): boolean {
  if (!isLegalKnockoutPointValue(points1, target) || !isLegalKnockoutPointValue(points2, target)) {
    return false;
  }
  if (points1 === points2) {
    return false;
  }
  const higher = Math.max(points1, points2);
  const margin = Math.abs(points1 - points2);
  return higher >= target && margin >= GAME_MIN_MARGIN;
}

/** Validates a knockout game against the round's target, throwing on a violation. */
export function validateKnockoutGameScore(
  points1: number,
  points2: number,
  target: number,
  gameNumber = 1,
): void {
  const label = `Game ${gameNumber}`;

  if (!isLegalKnockoutPointValue(points1, target) || !isLegalKnockoutPointValue(points2, target)) {
    throw new BusinessRuleViolationError(`${label}: points must be whole numbers.`);
  }
  if (points1 === points2) {
    throw new BusinessRuleViolationError(`${label} cannot end in a tie.`);
  }

  const higher = Math.max(points1, points2);
  const margin = Math.abs(points1 - points2);
  if (higher < target) {
    throw new BusinessRuleViolationError(
      `${label}: the winning participant must reach ${target} points.`,
    );
  }
  if (margin < GAME_MIN_MARGIN) {
    throw new BusinessRuleViolationError(
      `${label}: a game must be won by at least ${GAME_MIN_MARGIN} points.`,
    );
  }
}

/** A knockout game scored against a round's target. */
function scoreOneKnockoutGame(game: MatchGameInput, target: number): MatchGame {
  validateKnockoutGameScore(
    game.participant1Points,
    game.participant2Points,
    target,
    game.gameNumber,
  );
  return {
    gameNumber: game.gameNumber,
    participant1Points: game.participant1Points,
    participant2Points: game.participant2Points,
    winnerSlot: determineGameWinner(game.participant1Points, game.participant2Points),
  };
}

/** Whether a rule's format is decided by a single game ("Straight set"). */
export function isStraightSetFormat(rule: MatchScoringRule): boolean {
  return rule.format === 'single_game';
}

/**
 * Validates and scores a **knockout** result under a round's configured rule.
 *
 * The rule decides how many games a completed result contains and the points
 * each game is played to:
 *
 * - **best of 3** - two or three games, the first to two games wins, a third
 *   game after a 2-0 is rejected and a 1-1 split with no decider is rejected;
 * - **straight set** - exactly one game, the higher score wins, and any second
 *   or third game is rejected (there is no "best of 2").
 *
 * Every game is validated against the round's `pointsPerGame` target with the
 * standard two-point margin and no ceiling.
 */
export function scoreKnockoutMatch(
  games: readonly MatchGameInput[],
  rule: MatchScoringRule,
): readonly MatchGame[] {
  const straight = isStraightSetFormat(rule);
  const maxGames = straight ? 1 : MAX_GAMES_PER_MATCH;

  if (games.length < 1) {
    throw new BusinessRuleViolationError(
      straight ? 'Enter the game score.' : 'A completed result must contain at least two games.',
    );
  }
  if (games.length > maxGames) {
    throw new BusinessRuleViolationError(
      straight
        ? 'A straight-set match is decided by a single game.'
        : `A match is best of three and cannot contain more than ${MAX_GAMES_PER_MATCH} games.`,
    );
  }
  if (!straight && games.length < MIN_GAMES_PER_MATCH) {
    throw new BusinessRuleViolationError(
      `A completed result must contain at least ${MIN_GAMES_PER_MATCH} games.`,
    );
  }

  validateGameNumbers(games);

  const scored: MatchGame[] = [];
  let slot1Wins = 0;
  let slot2Wins = 0;

  for (const game of games) {
    if (!straight && (slot1Wins === GAMES_TO_WIN_MATCH || slot2Wins === GAMES_TO_WIN_MATCH)) {
      throw new BusinessRuleViolationError(
        'The match was already decided after two games; no further games are allowed.',
      );
    }

    const scoredGame = scoreOneKnockoutGame(game, rule.pointsPerGame);
    if (scoredGame.winnerSlot === 1) {
      slot1Wins += 1;
    } else {
      slot2Wins += 1;
    }
    scored.push(scoredGame);
  }

  if (straight) {
    return scored;
  }

  if (slot1Wins !== GAMES_TO_WIN_MATCH && slot2Wins !== GAMES_TO_WIN_MATCH) {
    throw new BusinessRuleViolationError(
      `The match is not decided; one participant must win ${GAMES_TO_WIN_MATCH} games.`,
    );
  }

  return scored;
}

/**
 * Derives the outcome of a stored knockout result under a round's rule.
 *
 * Reading a stored result never re-validates the points (they were validated on
 * write); it only applies the format's completion rule, so a straight-set match
 * is a single-game win and a best-of-three match requires two game wins.
 */
export function determineKnockoutOutcome(
  games: readonly MatchGame[],
  rule: MatchScoringRule,
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

  if (isStraightSetFormat(rule)) {
    if (games.length !== 1) {
      throw new BusinessRuleViolationError('A straight-set match is a single game.');
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
