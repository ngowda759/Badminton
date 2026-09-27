/**
 * Canonical normalization helpers.
 *
 * Normalization belongs in the domain layer so that every writer stores the
 * same canonical value, not just the API boundary. The database `CHECK` on
 * category codes and the uniqueness indexes on player contact details then
 * operate on already-normalized data.
 */

/** Collapses internal whitespace runs to a single space and trims the ends. */
export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Normalizes a category code to its stored form: trimmed, internal whitespace
 * removed, upper-cased.
 *
 * The stored form must satisfy `^[A-Z0-9-]{1,8}$` (database `CHECK`).
 */
export function normalizeCategoryCode(value: string): string {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

/** True when a normalized category code satisfies the database format. */
export function isValidCategoryCode(code: string): boolean {
  return /^[A-Z0-9-]{1,8}$/.test(code);
}

/**
 * Normalizes an email to lower case and trimmed.
 *
 * Only the casing and surrounding whitespace are changed; whether the value is
 * a well-formed address is a validation concern.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Normalizes a phone number by removing all characters except digits and a
 * leading `+`, so `+91 90000 00001` and `+91-9000000001` compare equal.
 */
export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const hasLeadingPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasLeadingPlus ? `+${digits}` : digits;
}

/** Normalizes an optional contact field, mapping blank input to `null`. */
export function normalizeOptionalContact(
  value: string | null | undefined,
  normalize: (input: string) => string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : normalize(trimmed);
}
