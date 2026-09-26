/**
 * A single field-level validation problem.
 *
 * `path` is a dotted location such as `query.page` so that clients can map
 * problems back onto inputs without parsing prose.
 */
export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Framework-agnostic description of a rejected request payload.
 *
 * Route handlers translate this into an HTTP response; keeping it free of
 * Fastify types lets the domain and tests reuse the same shape.
 */
export interface ValidationFailure {
  readonly issues: readonly ValidationIssue[];
}
