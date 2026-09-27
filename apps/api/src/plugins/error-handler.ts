import type { FastifyInstance } from 'fastify';

import { isApplicationError } from '@badminton/domain';

import { isRequestValidationError } from '../errors/api-error.ts';
import { mapError } from '../errors/http-error-mapper.ts';

/** Shape of every error the API returns, including unexpected failures. */
interface ErrorResponseBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: readonly { readonly path: string; readonly message: string }[];
  };
}

/**
 * Converts thrown failures into a stable, non-leaking error envelope.
 *
 * Application/domain errors are mapped by the central `mapError` (see
 * `errors/http-error-mapper.ts`), so a `ConflictError` never surfaces as a 500.
 * Fastify's own 4xx errors (malformed JSON, unregistered content type) keep
 * their status. Everything else becomes a generic 500 while the detail stays in
 * the log: SQL, driver messages, stack traces and file paths never reach the
 * client.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const mapped = toMappedError(error);

    if (mapped.statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
    } else {
      request.log.warn({ err: error }, 'request rejected');
    }

    void reply.status(mapped.statusCode).send(mapped.body);
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found.` },
    } satisfies ErrorResponseBody);
  });
}

function toMappedError(error: unknown): {
  readonly statusCode: number;
  readonly body: ErrorResponseBody;
} {
  if (isApplicationError(error) || isRequestValidationError(error)) {
    return mapError(error);
  }

  const statusCode = toStatusCode(error);
  if (statusCode < 500) {
    return {
      statusCode,
      body: { error: { code: toErrorCode(error), message: toErrorMessage(error) } },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' },
    },
  };
}

/** Reads Fastify's HTTP status without trusting the value's type. */
function toStatusCode(error: unknown): number {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500;
}

/** Client-safe error code. Fastify sets `code` for its own 4xx responses. */
function toErrorCode(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : 'REQUEST_ERROR';
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : 'Bad request.';
}
