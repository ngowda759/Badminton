import { parseRealtimeEventEnvelope } from '@badminton/validation';

/**
 * Connection lifecycle of a tournament realtime client.
 *
 * A typed union rather than arbitrary strings, so a consumer cannot compare
 * against a state the client never produces. `RECONNECTING` is a *temporary*
 * loss - the browser is expected to retry; `DISCONNECTED` is an intentional
 * stop (an explicit `stop()` or a torn-down client), never a transient error.
 */
export const REALTIME_CONNECTION_STATUSES = [
  'CONNECTING',
  'CONNECTED',
  'RECONNECTING',
  'DISCONNECTED',
] as const;

export type RealtimeConnectionStatus = (typeof REALTIME_CONNECTION_STATUSES)[number];

/**
 * The client-side view of one server realtime event.
 *
 * Deliberately small: it mirrors the Phase 8.2 `data` envelope and nothing
 * more. It is a *signal* that something changed, not a read model - a consumer
 * reacts by refetching authoritative REST state. `payload` stays `unknown`
 * because the client never interprets it.
 */
export interface RealtimeEvent {
  readonly id: string;
  readonly event: string;
  readonly tournamentId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly payload: unknown;
}

/**
 * Parses the `data` body of an SSE frame into a client event.
 *
 * Returns `undefined` for anything that is not valid JSON or does not carry a
 * complete envelope. The caller drops an `undefined` result and keeps the
 * connection: a malformed event is ignored, never thrown into React.
 */
export function parseRealtimeEvent(data: string): RealtimeEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }

  const envelope = parseRealtimeEventEnvelope(parsed);
  if (!envelope) {
    return undefined;
  }

  return {
    id: envelope.id,
    event: envelope.event,
    tournamentId: envelope.tournamentId,
    aggregateType: envelope.aggregateType,
    aggregateId: envelope.aggregateId,
    occurredAt: envelope.occurredAt,
    payload: envelope.payload,
  };
}
