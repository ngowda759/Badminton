import type { ValidationIssue } from '@badminton/validation';

/**
 * A request rejected by the HTTP boundary before any application service ran.
 *
 * Carrying the structured Zod issues lets the central error handler emit a
 * field-level 400 without every route re-implementing the response shape. It is
 * deliberately not an `ApplicationError`: it belongs to the transport layer,
 * not the domain error model.
 */
export class RequestValidationError extends Error {
  public override readonly name = 'RequestValidationError';

  public constructor(public readonly issues: readonly ValidationIssue[]) {
    super('Request validation failed.');
  }
}

/** True for a boundary validation failure. */
export function isRequestValidationError(error: unknown): error is RequestValidationError {
  return error instanceof RequestValidationError;
}
