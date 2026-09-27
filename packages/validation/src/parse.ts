import type { z } from 'zod';

import type { ValidationFailure, ValidationIssue } from './failure.ts';

/** Outcome of validating an untrusted input against a Zod schema. */
export type ParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly failure: ValidationFailure };

/** Converts a Zod error into the transport-agnostic failure shape. */
export function toValidationFailure(error: z.ZodError): ValidationFailure {
  const issues: ValidationIssue[] = error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));

  return { issues };
}

/**
 * Reusable request-validation entry point.
 *
 * Route handlers call this instead of `schema.parse` so that invalid input is
 * reported as data (which the handler turns into a 400) rather than a thrown
 * exception. Keeping it free of Fastify types means the same helper serves
 * later phases' request bodies, params and queries.
 */
export function parseRequest<S extends z.ZodType>(
  schema: S,
  input: unknown,
): ParseResult<z.output<S>> {
  const result = schema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return { success: false, failure: toValidationFailure(result.error) };
}
