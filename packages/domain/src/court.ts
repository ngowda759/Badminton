/**
 * Framework-free Court types for the Phase 7 operational layer.
 *
 * A court belongs to exactly one tournament and is unique by number within it.
 * Courts have a deliberately small lifecycle - ACTIVE or INACTIVE - because
 * "busy" is derived from scheduled/in-progress matches, not stored. This module
 * must stay free of Prisma, Fastify, React and any runtime dependency.
 */

/** The two court states, mirroring the database enum. */
export const COURT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type CourtStatus = (typeof COURT_STATUSES)[number];

/** A physical court a match can be played on. */
export interface Court {
  readonly id: string;
  readonly tournamentId: string;
  /** Operator-facing number; unique within a tournament. */
  readonly number: number;
  readonly name: string;
  readonly status: CourtStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
