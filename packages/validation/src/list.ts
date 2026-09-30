import { z } from 'zod';

/**
 * Shared list/pagination query schemas for the collection endpoints.
 *
 * Collection reads are cursor-paginated by opaque UUID cursor so a growing
 * dataset is never loaded unbounded and no `OFFSET` scan is introduced. The
 * cursor is the last id of the previous page; the repository resumes strictly
 * after it using the list's deterministic ordering.
 */

/** Hard ceiling on a single page; keeps a request from asking for everything. */
export const MAX_LIST_LIMIT = 100;

/** Default page size when the caller does not specify one. */
export const DEFAULT_LIST_LIMIT = 20;

/**
 * A list query as it arrives from the query string.
 *
 * `limit` and `cursor` are optional strings (query-string values are text);
 * the API normalizes them into the typed `ListQuery` the application services
 * accept. A non-numeric limit or a non-UUID cursor fails validation at the
 * boundary.
 */
export const listQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/, 'Limit must be a positive integer.')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value >= 1, 'Limit must be at least 1.')
    .refine((value) => value <= MAX_LIST_LIMIT, `Limit must not exceed ${MAX_LIST_LIMIT}.`)
    .optional(),
  cursor: z.uuid('Cursor must be a valid identifier.').optional(),
});

export type ListQueryInput = z.output<typeof listQuerySchema>;
