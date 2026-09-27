/**
 * Domain layer: framework-free contracts, types and pure business-rule helpers
 * shared by the application, infrastructure and (where relevant) the UI.
 *
 * This package has no runtime dependency. It must not import Prisma, Fastify or
 * React; persistence adapters map their rows onto the types declared here.
 */
export { API_STATUSES, DATABASE_STATUSES } from './health.ts';
export type { ApiStatus, DatabaseStatus, HealthResponse } from './health.ts';
export type {
  HealthCheck,
  HealthCheckFailureReason,
  ServiceHealth,
  ServiceName,
  SystemHealth,
} from './system-health.ts';

export { isAllowedTransition, isTerminal, type TransitionTable } from './lifecycle.ts';
export {
  TOURNAMENT_TRANSITIONS,
  CATEGORY_TRANSITIONS,
  ENTRY_TRANSITIONS,
  STAGE_TRANSITIONS,
  MATCH_TRANSITIONS,
  TOURNAMENT_REGISTRATION_STATUSES,
  CATEGORY_REGISTRATION_STATUS,
  ACTIVE_ENTRY_STATUSES,
} from './lifecycle-tables.ts';
export {
  normalizeWhitespace,
  normalizeCategoryCode,
  isValidCategoryCode,
  normalizeEmail,
  normalizePhone,
  normalizeOptionalContact,
} from './normalization.ts';
export { isValidIanaTimezone, toCalendarDate, isDateRangeValid } from './dates.ts';
export {
  MATCH_SLOTS,
  TOURNAMENT_STATUSES,
  CATEGORY_FORMATS,
  CATEGORY_GENDERS,
  CATEGORY_STATUSES,
  ENTRY_STATUSES,
  STAGE_TYPES,
  STAGE_STATUSES,
  MATCH_STATUSES,
} from './tournament.ts';
export type {
  CategoryFormat,
  CategoryGender,
  CategoryStatus,
  EntryStatus,
  Match,
  MatchParticipant,
  MatchSlot,
  MatchStatus,
  Player,
  StageStatus,
  StageType,
  Team,
  TeamMember,
  Tournament,
  TournamentCategory,
  TournamentEntry,
  TournamentStage,
  TournamentStatus,
} from './tournament.ts';
export {
  APPLICATION_ERROR_CODES,
  ApplicationError,
  ValidationError,
  NotFoundError,
  ConflictError,
  InvalidStateTransitionError,
  BusinessRuleViolationError,
  PersistenceError,
  isApplicationError,
} from './errors.ts';
export type { ApplicationErrorCode } from './errors.ts';
