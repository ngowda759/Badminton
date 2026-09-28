/**
 * Framework-free realtime contracts for Phase 8.
 *
 * Realtime is a *notification* channel, never a second business-logic path: a
 * `RealtimeEvent` records that something changed so that a browser can refetch
 * the authoritative REST state. It deliberately carries a small payload and no
 * read model, and it knows nothing about SSE, Prisma, Fastify or React.
 */

/**
 * The intentionally small realtime event catalogue.
 *
 * An event represents a meaningful, externally observable tournament-state
 * change - not every internal method call. GET requests, validation failures,
 * rejected transitions, failed transactions and unchanged updates never produce
 * an event.
 */
export const REALTIME_EVENT_TYPES = [
  'MATCH_SCHEDULED',
  'MATCH_UNSCHEDULED',
  'MATCH_STARTED',
  'MATCH_GAME_RECORDED',
  'MATCH_RESULT_RECORDED',
  'MATCH_COMPLETED',
  'MATCH_CANCELLED',
  'COURT_CREATED',
  'COURT_UPDATED',
  'COURT_STATUS_CHANGED',
  'KNOCKOUT_MATCH_POPULATED',
  'TOURNAMENT_STATUS_CHANGED',
  'CATEGORY_STATUS_CHANGED',
  'STAGE_STATUS_CHANGED',
  'ENTRY_STATUS_CHANGED',
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

/** The aggregate whose state changed. */
export const REALTIME_AGGREGATE_TYPES = [
  'MATCH',
  'COURT',
  'TOURNAMENT',
  'CATEGORY',
  'STAGE',
  'ENTRY',
] as const;
export type RealtimeAggregateType = (typeof REALTIME_AGGREGATE_TYPES)[number];

/**
 * A persisted realtime notification.
 *
 * The outbox stores exactly this shape. `payload` is optional and must stay
 * small - it may carry a couple of identifiers, never the dashboard or any
 * other replacement for a REST read model.
 */
export interface RealtimeEvent {
  readonly id: string;
  readonly tournamentId: string;
  readonly eventType: RealtimeEventType;
  readonly aggregateType: RealtimeAggregateType;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly publishedAt: Date | null;
}

/** True when `value` is one of the known event types. */
export function isRealtimeEventType(value: unknown): value is RealtimeEventType {
  return typeof value === 'string' && (REALTIME_EVENT_TYPES as readonly string[]).includes(value);
}

/** True when `value` is one of the known aggregate types. */
export function isRealtimeAggregateType(value: unknown): value is RealtimeAggregateType {
  return (
    typeof value === 'string' && (REALTIME_AGGREGATE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Validates the small, structured payload an event may carry.
 *
 * Payloads are flat maps of primitive values by design: nested objects would
 * invite clients to treat the event as a read model. `null`, `undefined` and an
 * empty object are all accepted and normalised to `null`.
 */
export function normalizeRealtimePayload(
  payload: Readonly<Record<string, unknown>> | null | undefined,
): Readonly<Record<string, unknown>> | null {
  if (!payload) {
    return null;
  }
  const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return null;
  }
  for (const [key, value] of entries) {
    if (!isPrimitive(value)) {
      throw new RealtimeEventValidationError(
        `Realtime event payload "${key}" must be a primitive value.`,
      );
    }
  }
  return Object.fromEntries(entries);
}

/** A payload value is a primitive scalar; arrays and objects are rejected. */
function isPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * A malformed realtime event.
 *
 * Kept local to the domain (rather than reusing `ValidationError`) because an
 * invalid event is a programmer error in the outbox, not a caller input
 * failure, and the API layer must treat it as such.
 */
export class RealtimeEventValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RealtimeEventValidationError';
  }
}
