/**
 * Pure scheduling helpers shared by the application layer and the UI.
 *
 * A schedule is always a half-open interval `[start, end)`: an end time that
 * equals another match's start time does not overlap, which is how back-to-back
 * matches on one court behave. These helpers are deliberately dependency-free:
 * they know nothing about Prisma, PostgreSQL or the exclusion constraint that
 * ultimately enforces the same rule at the database boundary.
 */

/** A half-open time window `[startAt, endAt)`. */
export interface ScheduleWindow {
  readonly startAt: Date;
  readonly endAt: Date;
}

/** A schedule is valid only when it has a positive duration. */
export function isValidScheduleRange(startAt: Date, endAt: Date): boolean {
  return startAt.getTime() < endAt.getTime();
}

/**
 * True when two half-open windows overlap.
 *
 * `existing.start < requested.end && requested.start < existing.end` correctly
 * treats touching windows (10:00-10:30 and 10:30-11:00) as non-overlapping.
 */
export function doScheduleWindowsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}
