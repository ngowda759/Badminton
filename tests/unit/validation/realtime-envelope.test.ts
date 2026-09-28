import {
  parseRealtimeEventEnvelope,
  realtimeEventEnvelopeSchema,
  tournamentIdSchema,
} from '@badminton/validation';
import { describe, expect, it } from 'vitest';

/** A complete, valid Phase 8.2 SSE `data` envelope. */
const VALID = {
  id: 'event-id',
  event: 'MATCH_COMPLETED',
  tournamentId: 'tournament-id',
  aggregateType: 'MATCH',
  aggregateId: 'match-id',
  occurredAt: '2026-09-28T10:00:00.000Z',
  payload: {},
};

describe('realtimeEventEnvelopeSchema', () => {
  it('accepts a complete envelope', () => {
    expect(realtimeEventEnvelopeSchema.safeParse(VALID).success).toBe(true);
  });

  it('accepts a null and an unknown-shaped payload without interpreting it', () => {
    expect(realtimeEventEnvelopeSchema.safeParse({ ...VALID, payload: null }).success).toBe(true);
    expect(
      realtimeEventEnvelopeSchema.safeParse({ ...VALID, payload: { nested: { a: 1 } } }).success,
    ).toBe(true);
  });

  it('accepts an event type the client does not know (forward compatible)', () => {
    expect(realtimeEventEnvelopeSchema.safeParse({ ...VALID, event: 'FUTURE_EVENT' }).success).toBe(
      true,
    );
  });

  it.each(['id', 'event', 'tournamentId', 'aggregateType', 'aggregateId', 'occurredAt'])(
    'rejects an envelope missing %s',
    (field) => {
      const incomplete = Object.fromEntries(Object.entries(VALID).filter(([key]) => key !== field));
      expect(realtimeEventEnvelopeSchema.safeParse(incomplete).success).toBe(false);
    },
  );

  it('rejects an empty required string', () => {
    expect(realtimeEventEnvelopeSchema.safeParse({ ...VALID, id: '' }).success).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(realtimeEventEnvelopeSchema.safeParse('nope').success).toBe(false);
    expect(realtimeEventEnvelopeSchema.safeParse(null).success).toBe(false);
  });

  it('returns undefined from parseRealtimeEventEnvelope for malformed input', () => {
    expect(parseRealtimeEventEnvelope({ ...VALID, event: '' })).toBeUndefined();
    expect(parseRealtimeEventEnvelope(VALID)).toEqual(VALID);
  });
});

describe('tournamentIdSchema', () => {
  it('accepts a uuid and rejects anything else', () => {
    expect(tournamentIdSchema.safeParse('11111111-1111-4111-8111-111111111111').success).toBe(true);
    expect(tournamentIdSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(tournamentIdSchema.safeParse('').success).toBe(false);
  });
});
