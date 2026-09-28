import type { RealtimeAggregateType, RealtimeEventType } from '@badminton/domain';

/**
 * The event-type and aggregate-type constants Phase 8.3 services publish.
 *
 * They are a typed alias of the domain catalogue so a service never scatters a
 * string literal: the compiler rejects a typo, and adding a new event is a
 * single edit here plus a catalogue entry in `@badminton/domain`.
 */
export const REALTIME_EVENTS = {
  MATCH_SCHEDULED: 'MATCH_SCHEDULED',
  MATCH_UNSCHEDULED: 'MATCH_UNSCHEDULED',
  MATCH_STARTED: 'MATCH_STARTED',
  MATCH_GAME_RECORDED: 'MATCH_GAME_RECORDED',
  MATCH_RESULT_RECORDED: 'MATCH_RESULT_RECORDED',
  MATCH_COMPLETED: 'MATCH_COMPLETED',
  MATCH_CANCELLED: 'MATCH_CANCELLED',
  COURT_CREATED: 'COURT_CREATED',
  COURT_UPDATED: 'COURT_UPDATED',
  COURT_STATUS_CHANGED: 'COURT_STATUS_CHANGED',
  KNOCKOUT_MATCH_POPULATED: 'KNOCKOUT_MATCH_POPULATED',
  TOURNAMENT_STATUS_CHANGED: 'TOURNAMENT_STATUS_CHANGED',
  CATEGORY_STATUS_CHANGED: 'CATEGORY_STATUS_CHANGED',
  STAGE_STATUS_CHANGED: 'STAGE_STATUS_CHANGED',
  ENTRY_STATUS_CHANGED: 'ENTRY_STATUS_CHANGED',
} as const satisfies Readonly<Record<string, RealtimeEventType>>;

export const REALTIME_AGGREGATES = {
  MATCH: 'MATCH',
  COURT: 'COURT',
  TOURNAMENT: 'TOURNAMENT',
  CATEGORY: 'CATEGORY',
  STAGE: 'STAGE',
  ENTRY: 'ENTRY',
} as const satisfies Readonly<Record<string, RealtimeAggregateType>>;
