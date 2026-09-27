/**
 * Lightweight client-side form validation.
 *
 * This gives immediate feedback only. The API remains authoritative: every
 * domain rule (date ordering across fields, code format, unique contacts) is
 * still enforced server-side, and server failures replace these messages.
 */

export type FieldErrors = Readonly<Record<string, string>>;

/** Required trimmed text within an optional maximum length. */
export function validateRequired(
  value: string,
  label: string,
  maxLength = 200,
): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return `${label} is required.`;
  }
  if (trimmed.length > maxLength) {
    return `${label} must be ${maxLength} characters or fewer.`;
  }
  return undefined;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?\d{7,15}$/;
const PHONE_SEPARATOR = /[\s().-]/g;

/** Validates an optional email: blank is allowed, otherwise must look valid. */
export function validateOptionalEmail(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return EMAIL_PATTERN.test(trimmed) ? undefined : 'Enter a valid email address.';
}

/** Validates an optional phone: blank is allowed, otherwise 7-15 digits. */
export function validateOptionalPhone(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  // Separators such as spaces, hyphens and parentheses are cosmetic; the API
  // accepts a normalised digit string, so validate what the user means.
  const normalized = trimmed.replace(PHONE_SEPARATOR, '');
  return PHONE_PATTERN.test(normalized) ? undefined : 'Enter a valid phone number (7-15 digits).';
}

/** Validates required calendar dates and that the range is ordered. */
export function validateDateRange(
  startDate: string,
  endDate: string,
): { readonly startDate?: string; readonly endDate?: string } {
  const errors: { startDate?: string; endDate?: string } = {};

  const start = startDate.trim();
  const end = endDate.trim();

  if (start.length === 0) {
    errors.startDate = 'Start date is required.';
  } else if (Number.isNaN(new Date(`${start}T00:00:00.000Z`).getTime())) {
    errors.startDate = 'Enter a valid start date.';
  }

  if (end.length === 0) {
    errors.endDate = 'End date is required.';
  } else if (Number.isNaN(new Date(`${end}T00:00:00.000Z`).getTime())) {
    errors.endDate = 'Enter a valid end date.';
  }

  if (!errors.startDate && !errors.endDate && end < start) {
    errors.endDate = 'End date must be on or after the start date.';
  }

  return errors;
}

/** Validates a required positive whole number (sequence, draw size, …). */
export function validatePositiveInteger(value: string, label: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return `${label} is required.`;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return `${label} must be a positive whole number.`;
  }
  return undefined;
}

/** Validates an optional positive whole number; blank is allowed. */
export function validateOptionalPositiveInteger(value: string, label: string): string | undefined {
  if (value.trim().length === 0) {
    return undefined;
  }
  return validatePositiveInteger(value, label);
}

/** Drops keys whose value is `undefined`, keeping the result a clean error map. */
export function compactErrors(errors: Record<string, string | undefined>): FieldErrors {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(errors)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
