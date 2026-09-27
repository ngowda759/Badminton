import {
  REALTIME_AGGREGATE_TYPES,
  REALTIME_EVENT_TYPES,
  RealtimeEventValidationError,
  isRealtimeAggregateType,
  isRealtimeEventType,
  normalizeRealtimePayload,
} from '@badminton/domain';
import { describe, expect, it } from 'vitest';

/**
 * Phase 8 realtime domain tests.
 *
 * The catalogue and payload rules are pure, so they are proven here without a
 * database: the event type list is intentionally small, an aggregate type must
 * be known, and a payload stays a flat map of primitives (it is a notification,
 * not a read model).
 */

describe('realtime event catalogue', () => {
  it('exposes the documented event types only', () => {
    expect([...REALTIME_EVENT_TYPES]).toEqual([
      'MATCH_SCHEDULED',
      'MATCH_UNSCHEDULED',
      'MATCH_STARTED',
      'MATCH_GAME_RECORDED',
      'MATCH_COMPLETED',
      'MATCH_CANCELLED',
      'COURT_CREATED',
      'COURT_UPDATED',
      'COURT_STATUS_CHANGED',
      'KNOCKOUT_MATCH_POPULATED',
    ]);
    expect([...REALTIME_AGGREGATE_TYPES]).toEqual(['MATCH', 'COURT']);
  });

  it('recognises known event types and rejects unknown ones', () => {
    expect(isRealtimeEventType('MATCH_COMPLETED')).toBe(true);
    expect(isRealtimeEventType('MATCH_EXPLODED')).toBe(false);
    expect(isRealtimeEventType(42)).toBe(false);
    expect(isRealtimeEventType(undefined)).toBe(false);
  });

  it('recognises known aggregate types and rejects unknown ones', () => {
    expect(isRealtimeAggregateType('MATCH')).toBe(true);
    expect(isRealtimeAggregateType('COURT')).toBe(true);
    expect(isRealtimeAggregateType('PLAYER')).toBe(false);
  });
});

describe('normalizeRealtimePayload', () => {
  it('normalises absent, null and empty payloads to null', () => {
    expect(normalizeRealtimePayload(undefined)).toBeNull();
    expect(normalizeRealtimePayload(null)).toBeNull();
    expect(normalizeRealtimePayload({})).toBeNull();
  });

  it('keeps a small flat map of primitives', () => {
    expect(normalizeRealtimePayload({ courtId: 'abc', number: 1, active: true })).toEqual({
      courtId: 'abc',
      number: 1,
      active: true,
    });
  });

  it('drops undefined values and keeps explicit nulls', () => {
    expect(normalizeRealtimePayload({ a: undefined, b: null })).toEqual({ b: null });
  });

  it('rejects nested objects and arrays', () => {
    expect(() => normalizeRealtimePayload({ dashboard: { matches: [] } })).toThrow(
      RealtimeEventValidationError,
    );
    expect(() => normalizeRealtimePayload({ ids: ['a', 'b'] })).toThrow(
      RealtimeEventValidationError,
    );
  });
});
