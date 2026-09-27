import { ApiError, type ApiErrorDetail } from '../api/client.ts';

/**
 * Turns any thrown value into a message safe to show a user.
 *
 * `ApiError` already carries a server-authored, non-leaking message. Anything
 * else (a bug, a parse failure) collapses to a generic phrase so stack traces
 * never reach the screen.
 */
export function toDisplayMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '';
  }
  return 'Something went wrong. Please try again.';
}

/** Extracts field-level validation problems from an API failure. */
export function fieldErrors(error: unknown): Readonly<Record<string, string>> {
  if (!(error instanceof ApiError) || error.details.length === 0) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const detail of error.details) {
    // First message wins so the field shows one clear problem.
    if (!(detail.path in result)) {
      result[detail.path] = detail.message;
    }
  }
  return result;
}

export type { ApiErrorDetail };
