/**
 * Client-side knockout bracket helpers.
 *
 * These mirror the supported bracket sizes and round naming of
 * `@badminton/domain` for immediate feedback; the API remains authoritative and
 * re-validates every bracket. No seeding, ranking or pairing is computed here -
 * the pairing is exactly the caller's ordering, which the setup UI preserves.
 */

export const SUPPORTED_BRACKET_SIZES = [2, 4, 8, 16, 32, 64, 128] as const;

/** True when `size` is a supported single-elimination bracket size. */
export function isSupportedBracketSize(size: number): boolean {
  return (SUPPORTED_BRACKET_SIZES as readonly number[]).includes(size);
}

/**
 * Name of the round that contains `matchesInRound` matches.
 *
 * A round sits log2(matchesInRound) rounds before the final: 1 match is the
 * final, 2 matches the semifinals, 4 the quarterfinals, and so on. This mirrors
 * `bracketRoundName` in `@badminton/domain` for immediate setup feedback.
 */
function roundName(matchesInRound: number): string {
  const roundsFromFinal = Math.log2(matchesInRound);
  if (roundsFromFinal === 0) {
    return 'Final';
  }
  if (roundsFromFinal === 1) {
    return 'Semifinals';
  }
  if (roundsFromFinal === 2) {
    return 'Quarterfinals';
  }
  return `Round of ${matchesInRound * 2}`;
}

/**
 * A one-line description of the rounds for a supported size, or `undefined`
 * when the count is not a supported bracket size.
 */
export function bracketShapeSummary(size: number): string | undefined {
  if (!isSupportedBracketSize(size)) {
    return undefined;
  }
  const roundCount = Math.log2(size);
  const parts: string[] = [];
  for (let round = 1; round <= roundCount; round += 1) {
    const matches = size / 2 ** round;
    parts.push(`${roundName(matches)} (${String(matches)})`);
  }
  return parts.join(', ');
}

/** A hint at the nearest supported size above `count`, or `undefined`. */
export function nextSupportedSizeLabel(count: number): string | undefined {
  if (count === 0 || isSupportedBracketSize(count)) {
    return undefined;
  }
  const next = SUPPORTED_BRACKET_SIZES.find((size) => size >= count);
  if (next === undefined) {
    return `A bracket supports at most ${String(SUPPORTED_BRACKET_SIZES.at(-1) ?? 128)} entries.`;
  }
  return `A bracket of ${String(count)} entries is not supported; select ${String(next)}.`;
}
