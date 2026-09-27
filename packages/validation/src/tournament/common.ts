import { isValidIanaTimezone, toCalendarDate } from '@badminton/domain';
import { z } from 'zod';

/**
 * Field primitives shared by the tournament application input schemas.
 *
 * These validate *shape and format* only. Cross-record business rules (date
 * ordering across two fields, category format versus entry owner) are enforced
 * by the application/domain layer, not here.
 */

/** A trimmed, non-empty name with the 200-character ceiling the design sets. */
export const nameSchema = z.string().trim().min(1, 'Name must not be empty.').max(200);

/**
 * A calendar date supplied as `YYYY-MM-DD` or a `Date`, normalized to UTC
 * midnight so that a tournament "running 3-5 October" has no invented
 * time-of-day.
 */
export const calendarDateSchema = z
  .union([z.iso.date('Expected a calendar date in YYYY-MM-DD form.'), z.date()])
  .transform((value) => (typeof value === 'string' ? new Date(`${value}T00:00:00.000Z`) : value))
  .transform(toCalendarDate);

/** An IANA timezone name, validated against the runtime's zone data. */
export const timezoneSchema = z
  .string()
  .trim()
  .min(1, 'Timezone must not be empty.')
  .refine(
    isValidIanaTimezone,
    'Timezone must be a valid IANA timezone name (for example Asia/Kolkata).',
  );

/**
 * An optional free-text field: absent, null or a trimmed non-empty string.
 * A blank string normalizes to `null`.
 */
export function optionalTextSchema(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();
}
