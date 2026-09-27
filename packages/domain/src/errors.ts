/**
 * Framework-free application/domain error model.
 *
 * Services throw these instead of leaking Prisma errors. Messages carry a safe,
 * human-readable description and never SQL, stack traces, credentials or
 * internal database details. Persistence adapters translate known constraint
 * failures onto these types (see `@badminton/infrastructure`).
 */

/** Stable, machine-readable error codes exposed to future API layers. */
export const APPLICATION_ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_STATE_TRANSITION',
  'BUSINESS_RULE_VIOLATION',
  'PERSISTENCE_ERROR',
] as const;
export type ApplicationErrorCode = (typeof APPLICATION_ERROR_CODES)[number];

/**
 * Base class for every expected application failure.
 *
 * `code` is what a future HTTP layer maps onto a status; `message` is safe to
 * return to a caller.
 */
export abstract class ApplicationError extends Error {
  public abstract readonly code: ApplicationErrorCode;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Input failed application-level validation. Maps to HTTP 400. */
export class ValidationError extends ApplicationError {
  public readonly code = 'VALIDATION_ERROR' as const;

  /** Optional dotted field path (`name`, `startDate`) for structured reporting. */
  public readonly field: string | undefined;

  public constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}

/** The referenced record does not exist. Maps to HTTP 404. */
export class NotFoundError extends ApplicationError {
  public readonly code = 'NOT_FOUND' as const;
  public readonly entity: string;
  public readonly id: string;

  public constructor(entity: string, id: string) {
    super(`${entity} ${id} was not found.`);
    this.entity = entity;
    this.id = id;
  }
}

/** A uniqueness or duplicate rule would be violated. Maps to HTTP 409. */
export class ConflictError extends ApplicationError {
  public readonly code = 'CONFLICT' as const;

  public constructor(message: string) {
    super(message);
  }
}

/** A lifecycle transition is not permitted from the current state. Maps to HTTP 409. */
export class InvalidStateTransitionError extends ApplicationError {
  public readonly code = 'INVALID_STATE_TRANSITION' as const;
  public readonly from: string;
  public readonly to: string;

  public constructor(entity: string, from: string, to: string) {
    super(`${entity} cannot move from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }
}

/** A cross-record business rule would be violated. Maps to HTTP 422. */
export class BusinessRuleViolationError extends ApplicationError {
  public readonly code = 'BUSINESS_RULE_VIOLATION' as const;

  public constructor(message: string) {
    super(message);
  }
}

/**
 * An unexpected persistence failure (connection loss, unmapped constraint).
 * Maps to HTTP 500 and deliberately hides the driver message.
 */
export class PersistenceError extends ApplicationError {
  public readonly code = 'PERSISTENCE_ERROR' as const;

  public constructor(message = 'A persistence error occurred.') {
    super(message);
  }
}

/** True for any error produced by the application/domain layer. */
export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError;
}
