import type { ListQuery } from '@badminton/application';
import { DEFAULT_LIST_LIMIT, parseRequest } from '@badminton/validation';
import type { z } from 'zod';

import { RequestValidationError } from '../errors/api-error.ts';

/**
 * Keys whose value type includes `undefined` become optional; the rest stay
 * required.
 *
 * Zod's inference marks `.optional()` outputs as `T | undefined` rather than
 * the `T?` the application command types declare. Under
 * `exactOptionalPropertyTypes` the two are incompatible, so `compact` narrows
 * the type as it strips absent keys. This keeps the mapping from request to
 * command fully typed with no assertions at the call site.
 */
export type Compact<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/**
 * Removes keys whose value is `undefined`.
 *
 * A request body routinely omits optional fields; Zod represents an omitted
 * field as `undefined`, but the application commands distinguish "absent" from
 * "explicit null". Dropping the `undefined` keys preserves that distinction.
 */
export function compact<T extends object>(value: T): Compact<T> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      result[key] = entry;
    }
  }
  return result as Compact<T>;
}

/**
 * Validates an untrusted value against a Zod schema.
 *
 * On failure it throws `RequestValidationError`, which the central error
 * handler turns into a `400` with field paths. Returning only on success keeps
 * route handlers linear and free of branching on parse results.
 */
export function validate<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = parseRequest(schema, input);
  if (!result.success) {
    throw new RequestValidationError(result.failure.issues);
  }
  return result.data;
}

/**
 * Normalizes a validated list query into the typed `ListQuery` the services use.
 *
 * Applies the default page size when `limit` is absent and drops an absent
 * cursor so the optional property is truly absent (not `undefined`), which
 * `exactOptionalPropertyTypes` requires.
 */
export function normalizeListQuery(query: {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}): ListQuery {
  return {
    limit: query.limit ?? DEFAULT_LIST_LIMIT,
    ...(query.cursor ? { cursor: query.cursor } : {}),
  };
}
