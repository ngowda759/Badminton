import type { FastifyInstance } from 'fastify';

/** Shape of every error the API returns, including unexpected failures. */
interface ErrorResponseBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

/**
 * Converts unhandled failures into a stable, non-leaking error envelope.
 *
 * Stack traces, driver messages, SQL and filesystem paths stay in the log; the
 * client receives only a generic message plus a correlation-friendly code.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const statusCode = toStatusCode(error);

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
    } else {
      request.log.warn({ err: error }, 'request rejected');
    }

    const body: ErrorResponseBody = {
      error: {
        code: statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : toErrorCode(error),
        message: statusCode >= 500 ? 'An unexpected error occurred.' : toErrorMessage(error),
      },
    };

    void reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found.` },
    } satisfies ErrorResponseBody);
  });
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
