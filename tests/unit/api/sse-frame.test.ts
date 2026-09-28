import { describe, expect, it } from 'vitest';

import type { RealtimeEvent } from '@badminton/domain';

import {
  SSE_HEARTBEAT_FRAME,
  toSseEventData,
  toSseEventFrame,
} from '../../../apps/api/src/http/sse/sse-frame.ts';

/** SSE framing unit tests: the wire format must be stable and unambiguous. */

function sampleEvent(overrides: Partial<RealtimeEvent> = {}): RealtimeEvent {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    tournamentId: '22222222-2222-2222-2222-222222222222',
    eventType: 'MATCH_COMPLETED',
    aggregateType: 'MATCH',
    aggregateId: '33333333-3333-3333-3333-333333333333',
    occurredAt: new Date('2026-09-27T10:00:00.000Z'),
    payload: { matchId: '33333333-3333-3333-3333-333333333333' },
    publishedAt: new Date('2026-09-27T10:00:01.000Z'),
    ...overrides,
  };
}

/** Parses an SSE frame into its `id`, `event` and `data` fields. */
function parseFrame(frame: string): { id: string; event: string; data: string } {
  const lines = frame.split('\n');
  const field = (name: string): string =>
    lines.find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2) ?? '';
  return { id: field('id'), event: field('event'), data: field('data') };
}

describe('SSE frame codec', () => {
  it('renders id, event and data fields followed by a blank line', () => {
    const frame = toSseEventFrame(sampleEvent());

    expect(frame.endsWith('\n\n')).toBe(true);
    const parsed = parseFrame(frame);
    expect(parsed.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(parsed.event).toBe('MATCH_COMPLETED');
  });

  it('produces valid JSON that mirrors the existing event model', () => {
    const event = sampleEvent();
    const data = JSON.parse(toSseEventData(event)) as Record<string, unknown>;

    expect(data).toEqual({
      id: event.id,
      event: 'MATCH_COMPLETED',
      tournamentId: event.tournamentId,
      aggregateType: 'MATCH',
      aggregateId: event.aggregateId,
      occurredAt: '2026-09-27T10:00:00.000Z',
      payload: { matchId: event.aggregateId },
    });
  });

  it('serialises a null payload without inventing fields', () => {
    const data = JSON.parse(toSseEventData(sampleEvent({ payload: null }))) as {
      payload: unknown;
    };
    expect(data.payload).toBeNull();
  });

  it('heartbeat is a comment frame, not a business event', () => {
    expect(SSE_HEARTBEAT_FRAME).toBe(': heartbeat\n\n');
    expect(SSE_HEARTBEAT_FRAME.startsWith(':')).toBe(true);
    const parsed = parseFrame(SSE_HEARTBEAT_FRAME);
    expect(parsed.event).toBe('');
    expect(parsed.data).toBe('');
  });
});
