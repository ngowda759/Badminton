import { describe, expect, it } from 'vitest';

import { bracketShapeSummary, isSupportedBracketSize, nextSupportedSizeLabel } from './bracket.ts';

/**
 * Client-side bracket helpers.
 *
 * These mirror the domain's supported sizes and round names for immediate setup
 * feedback; the API remains authoritative. The round naming must match
 * `bracketRoundName` in `@badminton/domain`, which the E2E flow also relies on.
 */
describe('bracket shape summary', () => {
  it('names rounds from the first round through to the final', () => {
    expect(bracketShapeSummary(2)).toBe('Final (1)');
    expect(bracketShapeSummary(4)).toBe('Semifinals (2), Final (1)');
    expect(bracketShapeSummary(8)).toBe('Quarterfinals (4), Semifinals (2), Final (1)');
    expect(bracketShapeSummary(16)).toBe(
      'Round of 16 (8), Quarterfinals (4), Semifinals (2), Final (1)',
    );
  });

  it('returns undefined for an unsupported size', () => {
    expect(bracketShapeSummary(3)).toBeUndefined();
    expect(bracketShapeSummary(0)).toBeUndefined();
    expect(bracketShapeSummary(256)).toBeUndefined();
  });
});

describe('isSupportedBracketSize', () => {
  it('accepts powers of two up to 128 and rejects everything else', () => {
    for (const size of [2, 4, 8, 16, 32, 64, 128]) {
      expect(isSupportedBracketSize(size)).toBe(true);
    }
    for (const size of [1, 3, 6, 100, 129]) {
      expect(isSupportedBracketSize(size)).toBe(false);
    }
  });
});

describe('nextSupportedSizeLabel', () => {
  it('suggests the nearest supported size for a bad count', () => {
    expect(nextSupportedSizeLabel(3)).toContain('select 4');
    expect(nextSupportedSizeLabel(5)).toContain('select 8');
  });

  it('stays silent for a valid or empty selection', () => {
    expect(nextSupportedSizeLabel(0)).toBeUndefined();
    expect(nextSupportedSizeLabel(8)).toBeUndefined();
  });
});
