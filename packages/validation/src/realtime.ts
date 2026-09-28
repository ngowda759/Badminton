import { z } from 'zod';

/**
 * Schema for the `data` body of a Phase 8.2 SSE event frame.
 *
 * The server frames an event as `id` / `event` / `data`, where `data` is the
 * JSON-encoded `RealtimeEvent`. This schema is the single runtime guard for
 * that payload on the browser side, so the client can never crash on a
 * malformed or unexpected event: an invalid frame is dropped, the connection
 * stays open.
 *
 * It validates only the *envelope* the client needs in order to act on the
 * event. The catalogue values are intentionally left as non-empty strings
 * rather than the domain unions: a client must still surface a well-formed
 * event whose type it does not yet know (a forward-compatible event added by a
 * later server release), and it never branches on the type itself - the UI
 * refetches authoritative REST state instead. `payload` is accepted as
 * anything (`unknown`) because it is only a small, opaque notification body.
 */
export const realtimeEventEnvelopeSchema = z.object({
  id: z.string().min(1),
  event: z.string().min(1),
  tournamentId: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  occurredAt: z.string().min(1),
  payload: z.unknown(),
});

/** The validated envelope of one realtime event frame. */
export type RealtimeEventEnvelope = z.infer<typeof realtimeEventEnvelopeSchema>;

/** Validates an untrusted SSE `data` payload; `undefined` when it is malformed. */
export function parseRealtimeEventEnvelope(input: unknown): RealtimeEventEnvelope | undefined {
  const result = realtimeEventEnvelopeSchema.safeParse(input);
  return result.success ? result.data : undefined;
}
