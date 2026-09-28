import type { RealtimeEvent } from '@badminton/domain';

/**
 * Server-Sent Events framing.
 *
 * The wire format is defined once here so the route, the heartbeat and the
 * tests never assemble a frame ad hoc. An event frame carries `id` (the outbox
 * row id), `event` (the Phase 8 event type) and a JSON `data` body describing
 * the existing `RealtimeEvent`; a heartbeat is a comment frame a client ignores.
 */

/**
 * A heartbeat comment frame.
 *
 * It has no `event`/`data` fields, so an SSE client never dispatches it as a
 * message: it only keeps proxies and the connection alive. It must never be
 * mistaken for a business event.
 */
export const SSE_HEARTBEAT_FRAME = ': heartbeat\n\n';

/** The JSON body of an event frame - the existing event model, not a second format. */
export function toSseEventData(event: RealtimeEvent): string {
  return JSON.stringify({
    id: event.id,
    event: event.eventType,
    tournamentId: event.tournamentId,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload,
  });
}

/**
 * Renders a persisted realtime event as one SSE frame.
 *
 * The frame is `id: <event-id>`, `event: <type>` and `data: <json>` so a client
 * can read the id, react to the type, and refetch authoritative REST state.
 */
export function toSseEventFrame(event: RealtimeEvent): string {
  return `id: ${event.id}\nevent: ${event.eventType}\ndata: ${toSseEventData(event)}\n\n`;
}
