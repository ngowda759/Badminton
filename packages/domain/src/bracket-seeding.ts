import { isSupportedBracketSize, type BracketSize } from './bracket.ts';
import { BusinessRuleViolationError } from './errors.ts';

/**
 * Pure knockout bracket seeding.
 *
 * Qualification produces a set of qualifiers grouped by their group; this module
 * turns that set into the first-round **pairings** the existing bracket generator
 * consumes. The generator fills round 1 from the pairs (slot 1 vs 2, 3 vs 4, ...),
 * so the number of pairs is `bracketSize / 2` and the total slots is
 * `bracketSize`.
 *
 * A **bye** is a first-round match with only one real competitor: slot 1 holds
 * the advancing seed and slot 2 stays empty, so the bye competitor's next
 * opponent is a first-round winner rather than another bye. A bye is never a
 * fake match and never has two real opponents.
 *
 * The seeding rules mirror the original tournament application so V2 draws
 * identically:
 *
 * - one group: the qualifiers in standing order;
 * - two groups: the classic cross-seed `A1 vs Bk`, `B1 vs Ak`, `A2 vs B(k-1)`, ...;
 * - three or more groups: rank-interleave every group (rank 1 of each group,
 *   then rank 2, ...), then snake-fold so the strongest seed meets the weakest.
 *
 * Byes are assigned to the strongest qualifiers, interleaved across groups
 * (`A1, B1, A2, B2, ...`), so they go to group winners first.
 */

/** The qualifiers of one group, in standing order (winner first). */
export interface SeededGroup {
  readonly groupId: string;
  readonly entryIds: readonly string[];
}

/** One first-round pairing; `second` is `null` for a bye. */
export interface SeededPairing {
  readonly first: string;
  readonly second: string | null;
}

/** The outcome of seeding: the first-round pairings plus the derived bracket shape. */
export interface BracketSeedResult {
  /** First-round pairings, in bracket order (`bracketSize / 2` of them). */
  readonly pairings: readonly SeededPairing[];
  /** Smallest supported bracket size that holds every qualifier. */
  readonly bracketSize: BracketSize;
  /** Bracket size minus the number of qualifiers; each bye advances a seed. */
  readonly byeCount: number;
  /** The seeded qualifier order before byes are spread (strongest first). */
  readonly seeds: readonly string[];
}

/**
 * Orders the qualifiers into bracket seed order (no byes).
 *
 * `groups` must be in a deterministic order (the caller supplies it). Empty
 * groups are ignored, and a qualifier never appears twice.
 */
export function seedBracket(groups: readonly SeededGroup[]): readonly string[] {
  const contributing = groups.filter((group) => group.entryIds.length > 0);

  if (contributing.length === 0) {
    return [];
  }
  if (contributing.length === 1) {
    return [...(contributing[0]?.entryIds ?? [])];
  }
  if (contributing.length === 2) {
    return crossSeed(contributing[0]?.entryIds ?? [], contributing[1]?.entryIds ?? []);
  }

  return snakeFold(rankInterleave(contributing));
}

/**
 * Classic two-group cross-seed: `A1 vs Bk`, `B1 vs Ak`, `A2 vs B(k-1)`, ...
 *
 * The result is a flat list in bracket order, so consecutive pairs meet in round
 * one. When the groups differ in size the shorter group's missing positions are
 * skipped, and no qualifier is ever dropped or duplicated.
 */
function crossSeed(first: readonly string[], second: readonly string[]): readonly string[] {
  const k = Math.max(first.length, second.length);
  const slots: string[] = [];

  for (let index = 0; index < k; index += 1) {
    let left: string | undefined;
    let right: string | undefined;
    if (index % 2 === 0) {
      const half = index / 2;
      left = first[half];
      right = second[k - 1 - half];
    } else {
      const half = (index - 1) / 2;
      left = second[half];
      right = first[k - 1 - half];
    }
    if (left !== undefined) {
      slots.push(left);
    }
    if (right !== undefined) {
      slots.push(right);
    }
  }

  return slots;
}

/** Rank 1 of every group, then rank 2 of every group, and so on. */
function rankInterleave(groups: readonly SeededGroup[]): readonly string[] {
  const maxRank = groups.reduce((max, group) => Math.max(max, group.entryIds.length), 0);
  const pool: string[] = [];

  for (let rank = 0; rank < maxRank; rank += 1) {
    for (const group of groups) {
      const entryId = group.entryIds[rank];
      if (entryId !== undefined) {
        pool.push(entryId);
      }
    }
  }

  return pool;
}

/** Folds the pool end-to-end so the strongest seed is drawn against the weakest. */
function snakeFold(pool: readonly string[]): readonly string[] {
  const folded: string[] = [];
  let low = 0;
  let high = pool.length - 1;

  while (low < high) {
    folded.push(pool[low] as string);
    folded.push(pool[high] as string);
    low += 1;
    high -= 1;
  }
  if (low === high) {
    folded.push(pool[low] as string);
  }

  return folded;
}

/**
 * Seeds the qualifiers and derives the bracket size, bye count and pairings.
 *
 * The bracket size is the smallest supported size that holds every qualifier.
 * Byes are spread evenly across the first round so a bye seed meets a
 * first-round winner next; the strongest qualifiers (rank-interleaved across
 * groups) receive the byes and the remaining qualifiers keep their seeded order,
 * preserving the draw balance.
 *
 * Rejects fewer than two qualifiers (nothing to play) and more qualifiers than
 * the largest supported bracket.
 */
export function buildBracketSeed(groups: readonly SeededGroup[]): BracketSeedResult {
  const seeds = seedBracket(groups);

  if (seeds.length < 2) {
    throw new BusinessRuleViolationError(
      'At least two competitors must qualify to build a knockout bracket.',
    );
  }

  const bracketSize = smallestSupportedSize(seeds.length);
  if (bracketSize === undefined) {
    throw new BusinessRuleViolationError(
      `A bracket of ${seeds.length} qualifiers is not supported; the largest bracket holds 128.`,
    );
  }

  const byeCount = bracketSize - seeds.length;
  const byeSeeds = rankInterleavedStrongest(groups, byeCount);
  const pairings = buildPairings(seeds, bracketSize, byeCount, byeSeeds);

  return { pairings, bracketSize, byeCount, seeds };
}

/**
 * The strongest qualifiers that receive the byes, interleaved across groups
 * (`A1, B1, A2, B2, ...`) so group winners are rewarded first.
 */
function rankInterleavedStrongest(
  groups: readonly SeededGroup[],
  count: number,
): readonly string[] {
  const contributing = groups.filter((group) => group.entryIds.length > 0);
  const order = rankInterleave(contributing);
  return order.slice(0, count);
}

/**
 * Builds the first-round pairings, spreading byes across the round.
 *
 * Bye positions use the standard "spread evenly" rule so they never cluster at
 * one end. The bye seeds are removed from the playing pool; the remaining
 * qualifiers fill the open slots in seeded order.
 */
function buildPairings(
  seeds: readonly string[],
  bracketSize: BracketSize,
  byeCount: number,
  byeSeeds: readonly string[],
): readonly SeededPairing[] {
  const firstRoundMatches = bracketSize / 2;
  const byeMatches = new Set<number>();

  if (byeCount > 0) {
    let last = 0;
    for (let index = 0; index < firstRoundMatches; index += 1) {
      const fraction = Math.floor(((index + 1) * byeCount) / firstRoundMatches);
      if (fraction > last) {
        byeMatches.add(index);
        last = fraction;
      }
    }
  }

  const byeSet = new Set(byeSeeds);
  const playing = seeds.filter((seed) => !byeSet.has(seed));

  const pairings: SeededPairing[] = [];
  let byeCursor = 0;
  let playCursor = 0;

  for (let matchIndex = 0; matchIndex < firstRoundMatches; matchIndex += 1) {
    if (byeMatches.has(matchIndex)) {
      pairings.push({ first: byeSeeds[byeCursor] as string, second: null });
      byeCursor += 1;
    } else {
      pairings.push({
        first: playing[playCursor] as string,
        second: playing[playCursor + 1] as string,
      });
      playCursor += 2;
    }
  }

  return pairings;
}

/** The smallest supported bracket size that is at least `count`. */
function smallestSupportedSize(count: number): BracketSize | undefined {
  const sizes = [2, 4, 8, 16, 32, 64, 128] as const;
  return sizes.find((size) => size >= count && isSupportedBracketSize(size));
}
