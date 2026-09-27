import { COURT_STATUSES, doScheduleWindowsOverlap, isValidScheduleRange } from '@badminton/domain';
import { describe, expect, it } from 'vitest';

/**
 * Pure scheduling helper tests.
 *
 * A schedule is a half-open interval `[start, end)`: touching windows do not
 * overlap, which is how back-to-back matches on one court behave.
 */

const at = (hour: number, minute = 0): Date => new Date(Date.UTC(2026, 9, 5, hour, minute, 0, 0));

describe('isValidScheduleRange', () => {
  it('accepts a start strictly before the end', () => {
    expect(isValidScheduleRange(at(10), at(10, 30))).toBe(true);
  });

  it('rejects an equal start and end', () => {
    expect(isValidScheduleRange(at(10), at(10))).toBe(false);
  });

  it('rejects an end before the start', () => {
    expect(isValidScheduleRange(at(10, 30), at(10))).toBe(false);
  });
});

describe('doScheduleWindowsOverlap', () => {
  it('treats adjacent windows as non-overlapping', () => {
    // 10:00-10:30 and 10:30-11:00 share only their boundary.
    expect(doScheduleWindowsOverlap(at(10), at(10, 30), at(10, 30), at(11))).toBe(false);
  });

  it('detects a partial overlap', () => {
    // 10:00-10:30 and 10:29-11:00.
    expect(doScheduleWindowsOverlap(at(10), at(10, 30), at(10, 29), at(11))).toBe(true);
  });

  it('detects a fully contained window', () => {
    // 10:00-10:30 contains 10:15-10:20.
    expect(doScheduleWindowsOverlap(at(10), at(10, 30), at(10, 15), at(10, 20))).toBe(true);
  });

  it('detects a window that ends exactly when another starts as non-overlapping', () => {
    expect(doScheduleWindowsOverlap(at(9), at(10), at(10), at(10, 30))).toBe(false);
  });

  it('detects non-overlapping windows separated in time', () => {
    expect(doScheduleWindowsOverlap(at(10), at(10, 30), at(11), at(11, 30))).toBe(false);
  });

  it('is symmetric', () => {
    const forward = doScheduleWindowsOverlap(at(10), at(10, 30), at(10, 15), at(10, 45));
    const backward = doScheduleWindowsOverlap(at(10, 15), at(10, 45), at(10), at(10, 30));
    expect(forward).toBe(true);
    expect(backward).toBe(true);
  });
});

describe('COURT_STATUSES', () => {
  it('has exactly the two operator-facing states', () => {
    expect([...COURT_STATUSES].sort()).toEqual(['ACTIVE', 'INACTIVE']);
  });
});
