import { describe, expect, it } from 'vitest';

import { isResultCorrectable } from './correction.ts';

/**
 * Client-side result-correction predicate.
 *
 * It mirrors the domain rule for immediate feedback: only a COMPLETED match has
 * a result to correct, for either a group or a knockout stage. The API stays
 * authoritative.
 */
describe('isResultCorrectable', () => {
  it('is true only for a completed match', () => {
    expect(isResultCorrectable('COMPLETED')).toBe(true);
    expect(isResultCorrectable('SCHEDULED')).toBe(false);
    expect(isResultCorrectable('IN_PROGRESS')).toBe(false);
    expect(isResultCorrectable('CANCELLED')).toBe(false);
  });
});
