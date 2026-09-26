/**
 * Shared Zod schemas and request-validation helpers.
 *
 * Phase 1 covers health plus the generic `parseRequest` pattern that later
 * phases will use for tournament payloads. No tournament schemas exist yet.
 */
export type { ValidationFailure, ValidationIssue } from './failure.ts';
export { parseRequest, toValidationFailure, type ParseResult } from './parse.ts';
export { healthResponseSchema, parseHealthResponse } from './health.ts';
