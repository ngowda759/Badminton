import { isMatchCorrectable, type Match } from '@badminton/domain';
import { describe, expect, it } from 'vitest';

/**
 * Result-correction predicate.
 *
 * The rule is pure, so it is proven here without a database: a result may be
 * corrected only for a completed **group** match. A knockout match carries a
 * bracket position (`roundNumber`/`matchNumber`), which marks it immutable, and
 * a match that has not completed has no recorded result to correct.
 */

function match(overrides: Partial<Match> = {}): Match {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: '88888888-8888-4888-8888-888888888888',
    stageId: '77777777-7777-4777-8777-777777777777',
    sequence: 1,
    roundNumber: null,
    matchNumber: null,
    status: 'COMPLETED',
    winnerEntryId: '66666666-6666-4666-8666-666666666666',
    knockoutFormat: null,
    knockoutPointsPerGame: null,
    courtId: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('isMatchCorrectable', () => {
  it('is true for a completed group match (no bracket position)', () => {
    expect(isMatchCorrectable(match())).toBe(true);
  });

  it('is false for a completed knockout match (non-null bracket position)', () => {
    expect(isMatchCorrectable(match({ roundNumber: 1, matchNumber: 1 }))).toBe(false);
    expect(isMatchCorrectable(match({ roundNumber: 2, matchNumber: null }))).toBe(false);
    expect(isMatchCorrectable(match({ roundNumber: null, matchNumber: 3 }))).toBe(false);
  });

  it('is false for any non-completed match', () => {
    for (const status of ['SCHEDULED', 'IN_PROGRESS', 'CANCELLED'] as const) {
      expect(isMatchCorrectable(match({ status }))).toBe(false);
    }
  });
});
