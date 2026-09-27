import {
  BusinessRuleViolationError,
  ConflictError,
  InvalidStateTransitionError,
  isApplicationError,
  NotFoundError,
  PersistenceError,
  ValidationError,
  type ApplicationError,
} from '@badminton/domain';
import type { ValidationIssue } from '@badminton/validation';

import { isRequestValidationError } from './api-error.ts';

/**
 * Single mapping from application/domain failures onto HTTP.
 *
 * Keeping the mapping in one place means every route reports the same status
 * for the same failure, and unexpected errors never leak internal detail.
 */

/** HTTP status for each application error code. */
const STATUS_BY_CODE: Readonly<Record<ApplicationError['code'], number>> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  BUSINESS_RULE_VIOLATION: 422,
  PERSISTENCE_ERROR: 500,
};

export interface ErrorDetail {
  readonly code: string;
  readonly message: string;
  /** Field-level problems for validation failures; omitted otherwise. */
  readonly details?: readonly ValidationIssue[];
}

export interface MappedError {
  readonly statusCode: number;
  readonly body: { readonly error: ErrorDetail };
}

/**
 * Maps a thrown value onto a status and a client-safe body.
 *
 * `ApplicationError` subclasses carry a stable code and a message that is safe
 * to return. Anything else is treated as unexpected: the detail is logged by
 * the caller, and the client receives a generic 500 so stack traces, SQL and
 * connection strings can never escape.
 */
export function mapError(error: unknown): MappedError {
  if (isRequestValidationError(error)) {
    return validationError(error.issues);
  }

  if (error instanceof ValidationError) {
    return validationError(
      error.field === undefined ? [] : [{ path: error.field, message: error.message }],
    );
  }

  if (isApplicationError(error)) {
    return { statusCode: STATUS_BY_CODE[error.code], body: { error: errorDetail(error) } };
  }

  return {
    statusCode: 500,
    body: {
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' },
    },
  };
}

function validationError(issues: readonly ValidationIssue[]): MappedError {
  return {
    statusCode: 400,
    body: {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        ...(issues.length > 0 ? { details: issues } : {}),
      },
    },
  };
}

function errorDetail(error: ApplicationError): ErrorDetail {
  // `PersistenceError` is an unexpected internal failure: its message is safe
  // by construction, but the response is still reduced to a generic phrase so
  // no persistence detail can distinguish one deployment from another.
  const message =
    error instanceof PersistenceError ? 'An unexpected error occurred.' : error.message;

  const detail: ErrorDetail = { code: error.code, message };

  if (error instanceof NotFoundError) {
    return { ...detail, details: [{ path: 'id', message: error.message }] };
  }
  if (error instanceof ConflictError || error instanceof BusinessRuleViolationError) {
    return detail;
  }
  if (error instanceof InvalidStateTransitionError) {
    return {
      ...detail,
      details: [{ path: 'status', message: `Cannot move from ${error.from} to ${error.to}.` }],
    };
  }

  return detail;
}
