import { API_STATUSES, DATABASE_STATUSES, type HealthResponse } from '@badminton/domain';
import { z } from 'zod';

/**
 * Schema for `GET /health`.
 *
 * Doubles as the Fastify response serialiser schema and as the client-side
 * runtime guard, so the API cannot drift from what the UI expects.
 */
export const healthResponseSchema = z.object({
  status: z.enum(API_STATUSES),
  database: z.enum(DATABASE_STATUSES),
}) satisfies z.ZodType<HealthResponse>;

/** Validates an untrusted `/health` payload. Used by the web client. */
export function parseHealthResponse(input: unknown): HealthResponse | undefined {
  const result = healthResponseSchema.safeParse(input);
  return result.success ? result.data : undefined;
}
