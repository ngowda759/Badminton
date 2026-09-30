/**
 * Framework-free domain types and pure business-rule helpers for the Phase 2
 * tournament aggregates.
 *
 * This module must stay free of Prisma, Fastify, React and any runtime
 * dependency. Persistence adapters map Prisma rows onto these types.
 */

/** All six tournament lifecycle states, mirroring the database enum. */
export const TOURNAMENT_STATUSES = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

export const CATEGORY_FORMATS = ['SINGLES', 'DOUBLES'] as const;
export type CategoryFormat = (typeof CATEGORY_FORMATS)[number];

export const CATEGORY_GENDERS = ['MALE', 'FEMALE', 'MIXED', 'OPEN'] as const;
export type CategoryGender = (typeof CATEGORY_GENDERS)[number];

export const CATEGORY_STATUSES = ['DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED'] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

export const ENTRY_STATUSES = ['PENDING', 'CONFIRMED', 'WITHDRAWN', 'DISQUALIFIED'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const STAGE_TYPES = ['GROUP', 'KNOCKOUT'] as const;
export type StageType = (typeof STAGE_TYPES)[number];

export const STAGE_STATUSES = ['PENDING', 'ACTIVE', 'COMPLETED'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const MATCH_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** Slot on a match: side A (1) or side B (2). */
export const MATCH_SLOTS = [1, 2] as const;
export type MatchSlot = (typeof MATCH_SLOTS)[number];

export interface Tournament {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly location: string | null;
  readonly timezone: string;
  readonly status: TournamentStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TournamentCategory {
  readonly id: string;
  readonly tournamentId: string;
  readonly name: string;
  readonly code: string;
  readonly format: CategoryFormat;
  readonly gender: CategoryGender | null;
  readonly status: CategoryStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Team {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TeamMember {
  readonly id: string;
  readonly teamId: string;
  readonly playerId: string;
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TournamentEntry {
  readonly id: string;
  readonly categoryId: string;
  readonly playerId: string | null;
  readonly teamId: string | null;
  readonly seed: number | null;
  readonly status: EntryStatus;
  readonly registeredAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TournamentStage {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly type: StageType;
  readonly sequence: number;
  readonly drawSize: number | null;
  /**
   * How many competitors advance from each group into this stage's feeder
   * knockout. `null` when unset (a GROUP stage, or a knockout not yet
   * configured). Qualification reads it from the feeder GROUP stage.
   */
  readonly qualifiersPerGroup: number | null;
  readonly status: StageStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Match {
  readonly id: string;
  readonly stageId: string;
  readonly sequence: number;
  readonly roundNumber: number | null;
  readonly matchNumber: number | null;
  readonly status: MatchStatus;
  /**
   * The entry that won a completed match, or `null` before completion. Derived
   * from the validated games and set in the same transaction that completes the
   * match; it is never chosen by a caller.
   */
  readonly winnerEntryId: string | null;
  /**
   * Scheduling information is optional: a match can exist before an operator
   * decides where and when it is played. `courtId`, `scheduledStartAt` and
   * `scheduledEndAt` are always all-set or all-null together.
   */
  readonly courtId: string | null;
  readonly scheduledStartAt: Date | null;
  readonly scheduledEndAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The scheduling slice of a match.
 *
 * A start/end pair plus the owning court; `null` means the match is unscheduled.
 * The application layer treats a schedule as one atomic value so a partially
 * populated schedule is never persisted.
 */
export interface MatchSchedule {
  readonly courtId: string;
  readonly scheduledStartAt: Date;
  readonly scheduledEndAt: Date;
}

export interface MatchParticipant {
  readonly id: string;
  readonly matchId: string;
  readonly entryId: string;
  readonly slot: MatchSlot;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
