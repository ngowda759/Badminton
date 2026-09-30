/**
 * Client-side group-fixture helpers.
 *
 * A GROUP stage's fixtures are a complete round-robin: every competitor plays
 * every other competitor exactly once, so `n` competitors produce
 * `n * (n - 1) / 2` matches. This mirrors the server's rule for immediate
 * feedback; the API remains authoritative and re-validates every generation.
 */

/** Matches a complete round-robin of `count` competitors contains. */
export function roundRobinMatchCount(count: number): number {
  return count < 2 ? 0 : (count * (count - 1)) / 2;
}

/**
 * A one-line description of what will be generated for `count` selected
 * entries, or a prompt to keep selecting.
 */
export function groupFixtureSummary(count: number): string {
  if (count < 2) {
    return count === 0
      ? 'Select entries to build fixtures.'
      : 'Select at least two entries to build a round-robin.';
  }
  const matches = roundRobinMatchCount(count);
  return `${String(count)} selected — ${String(matches)} ${matches === 1 ? 'match' : 'matches'} (every entry plays every other once).`;
}
