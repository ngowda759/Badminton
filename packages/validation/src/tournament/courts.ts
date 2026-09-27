import { COURT_STATUSES } from '@badminton/domain';
import { z } from 'zod';

/**
 * Request schemas for Phase 7 court management and match scheduling.
 *
 * As with the other input schemas, only shape and format are validated here.
 * Whether a court belongs to the match's tournament, whether it is active and
 * whether its window clashes with an existing match are application/domain
 * rules enforced by the services.
 */

/** A 1-based positive ordinal (court number). */
const positiveIntegerSchema = z.coerce
  .number()
  .int('Must be a whole number.')
  .positive('Must be a positive number.');

const maxNameLength = 200;

/** A court display name. */
export const courtNameSchema = z
  .string()
  .trim()
  .min(1, 'Court name must not be empty.')
  .max(maxNameLength, `Court name must be at most ${maxNameLength} characters.`);

/**
 * An ISO-8601 instant with a timezone designator, normalized to a `Date`.
 *
 * Scheduling times are absolute instants, not calendar dates, so the offset is
 * required to avoid ambiguity.
 */
export const scheduledInstantSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const createCourtInputSchema = z.object({
  number: positiveIntegerSchema,
  name: courtNameSchema,
});

export const updateCourtInputSchema = z
  .object({
    number: positiveIntegerSchema,
    name: courtNameSchema,
  })
  .partial();

export const courtTransitionInputSchema = z.object({
  status: z.enum(COURT_STATUSES),
});

export const scheduleMatchInputSchema = z.object({
  courtId: z.uuid(),
  scheduledStartAt: scheduledInstantSchema,
  scheduledEndAt: scheduledInstantSchema,
});

export type CreateCourtInput = z.input<typeof createCourtInputSchema>;
export type UpdateCourtInput = z.input<typeof updateCourtInputSchema>;
export type CourtTransitionInput = z.input<typeof courtTransitionInputSchema>;
export type ScheduleMatchInput = z.input<typeof scheduleMatchInputSchema>;
