import type { TransitionTable } from './lifecycle.ts';
import type { CourtStatus } from './court.ts';
import type {
  CategoryStatus,
  EntryStatus,
  MatchStatus,
  StageStatus,
  TournamentStatus,
} from './tournament.ts';

/**
 * Allowed lifecycle transitions for the Phase 2 aggregates.
 *
 * Terminal states map to an empty list, so no transition out of
 * `COMPLETED` / `CANCELLED` / `WITHDRAWN` / `DISQUALIFIED` is ever allowed.
 * See `docs/phase-2-domain-design.md` §13.
 */
export const TOURNAMENT_TRANSITIONS: TransitionTable<TournamentStatus> = {
  DRAFT: ['REGISTRATION_OPEN', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const CATEGORY_TRANSITIONS: TransitionTable<CategoryStatus> = {
  DRAFT: ['OPEN', 'CANCELLED'],
  OPEN: ['CLOSED', 'CANCELLED'],
  CLOSED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const ENTRY_TRANSITIONS: TransitionTable<EntryStatus> = {
  PENDING: ['CONFIRMED', 'WITHDRAWN', 'DISQUALIFIED'],
  CONFIRMED: ['WITHDRAWN', 'DISQUALIFIED'],
  WITHDRAWN: [],
  DISQUALIFIED: [],
};

export const STAGE_TRANSITIONS: TransitionTable<StageStatus> = {
  PENDING: ['ACTIVE'],
  ACTIVE: ['COMPLETED'],
  COMPLETED: [],
};

export const MATCH_TRANSITIONS: TransitionTable<MatchStatus> = {
  SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Court status has no terminal state: a court may always be reactivated or
 * taken out of service, because deactivating one never destroys its historical
 * matches.
 */
export const COURT_TRANSITIONS: TransitionTable<CourtStatus> = {
  ACTIVE: ['INACTIVE'],
  INACTIVE: ['ACTIVE'],
};

/** Tournament states in which registration is permitted. */
export const TOURNAMENT_REGISTRATION_STATUSES: readonly TournamentStatus[] = ['REGISTRATION_OPEN'];

/** Category state in which registration is permitted. */
export const CATEGORY_REGISTRATION_STATUS: CategoryStatus = 'OPEN';

/**
 * Entry states that still occupy a competitor's place in a category.
 *
 * `WITHDRAWN` and `DISQUALIFIED` are terminal and no longer "active", which is
 * what the player-in-two-teams rule and participant eligibility check against.
 */
export const ACTIVE_ENTRY_STATUSES: readonly EntryStatus[] = ['PENDING', 'CONFIRMED'];
