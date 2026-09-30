import {
  isValidCategoryCode,
  normalizeCategoryCode,
  normalizeEmail,
  normalizeOptionalContact,
  normalizePhone,
} from '@badminton/domain';
import { z } from 'zod';

import { calendarDateSchema, nameSchema, optionalTextSchema, timezoneSchema } from './common.ts';

/**
 * Application input schemas for the Phase 2 aggregates.
 *
 * Each schema validates shape/format, trims strings and normalizes values the
 * domain treats as canonical (category code to upper case, email to lower case,
 * phone to digits with an optional leading `+`). Cross-record rules - date
 * ordering, category format versus entry owner - are enforced by the services.
 */

/** A normalized category code: `^[A-Z0-9-]{1,8}$`. */
export const categoryCodeSchema = z
  .string()
  .transform(normalizeCategoryCode)
  .refine(isValidCategoryCode, 'Category code must be 1-8 characters of A-Z, 0-9 or hyphen.');

/** A 1-based positive ordinal (sequence, position, round number). */
const positiveIntegerSchema = z.coerce
  .number()
  .int('Must be a whole number.')
  .positive('Must be a positive number.');

const emailSchema = z.email('Enter a valid email address.');

/** An optional email, lower-cased; blank input normalizes to `null`. */
export const optionalEmailSchema = z
  .string()
  .trim()
  .transform((value) => normalizeOptionalContact(value, normalizeEmail))
  .refine((value) => value === null || emailSchema.safeParse(value).success, {
    message: 'Enter a valid email address.',
  })
  .nullable()
  .optional();

const phonePattern = /^\+?\d{7,15}$/;

/** An optional phone number, reduced to digits; blank input normalizes to `null`. */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .transform((value) => normalizeOptionalContact(value, normalizePhone))
  .refine((value) => value === null || phonePattern.test(value), {
    message: 'Enter a valid phone number (7-15 digits, optional leading +).',
  })
  .nullable()
  .optional();

export const createTournamentInputSchema = z.object({
  name: nameSchema,
  description: optionalTextSchema(2000),
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
  location: optionalTextSchema(200),
  timezone: timezoneSchema,
});

export const updateTournamentInputSchema = z
  .object({
    name: nameSchema,
    description: optionalTextSchema(2000),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
    location: optionalTextSchema(200),
  })
  .partial();

export const createCategoryInputSchema = z.object({
  name: nameSchema,
  code: categoryCodeSchema,
  format: z.enum(['SINGLES', 'DOUBLES']),
  gender: z.enum(['MALE', 'FEMALE', 'MIXED', 'OPEN']).nullable().optional(),
});

export const updateCategoryInputSchema = z
  .object({
    name: nameSchema,
    format: z.enum(['SINGLES', 'DOUBLES']),
    gender: z.enum(['MALE', 'FEMALE', 'MIXED', 'OPEN']).nullable(),
  })
  .partial();

export const createPlayerInputSchema = z.object({
  name: nameSchema,
  email: optionalEmailSchema,
  phone: optionalPhoneSchema,
});

export const updatePlayerInputSchema = z
  .object({
    name: nameSchema,
    email: optionalEmailSchema,
    phone: optionalPhoneSchema,
  })
  .partial();

export const createTeamInputSchema = z.object({
  name: z.string().trim().min(1, 'Team name must not be empty.').max(200),
  memberPlayerIds: z.array(z.uuid()).max(8).optional(),
});

export const updateTeamInputSchema = z.object({
  name: z.string().trim().min(1, 'Team name must not be empty.').max(200),
});

export const addTeamMemberInputSchema = z.object({
  playerId: z.uuid(),
  position: positiveIntegerSchema.optional(),
});

export const removeTeamMemberInputSchema = z.object({
  playerId: z.uuid(),
});

export const registerTournamentEntryInputSchema = z.object({
  categoryId: z.uuid(),
  playerId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  seed: positiveIntegerSchema.optional(),
});

/**
 * Registration body for `POST /categories/:categoryId/entries`, where the
 * category is supplied by the path rather than the body.
 */
export const registerEntryBodySchema = registerTournamentEntryInputSchema.omit({
  categoryId: true,
});

export const updateTournamentEntryInputSchema = z.object({
  seed: positiveIntegerSchema.nullable().optional(),
});

export const createStageInputSchema = z.object({
  name: nameSchema,
  type: z.enum(['GROUP', 'KNOCKOUT']),
  sequence: positiveIntegerSchema,
  drawSize: positiveIntegerSchema.optional(),
  // How many competitors advance from each group into this stage's feeder
  // knockout. Only meaningful on a KNOCKOUT stage; validated as positive.
  qualifiersPerGroup: positiveIntegerSchema.optional(),
});

export const updateStageInputSchema = z
  .object({
    name: nameSchema,
    sequence: positiveIntegerSchema,
    drawSize: positiveIntegerSchema.nullable(),
    qualifiersPerGroup: positiveIntegerSchema.nullable(),
  })
  .partial();

export const createMatchInputSchema = z.object({
  sequence: positiveIntegerSchema,
  roundNumber: positiveIntegerSchema.optional(),
  matchNumber: positiveIntegerSchema.optional(),
});

export const updateMatchInputSchema = z
  .object({
    sequence: positiveIntegerSchema,
    roundNumber: positiveIntegerSchema.nullable(),
    matchNumber: positiveIntegerSchema.nullable(),
  })
  .partial();

export const addMatchParticipantInputSchema = z.object({
  entryId: z.uuid(),
  slot: z.union([z.literal(1), z.literal(2)]),
});

/**
 * Bracket generation request.
 *
 * Only the request *shape* is validated here: a non-empty list of entry UUIDs.
 * Whether the count is a supported bracket size, whether the entries belong to
 * the stage's category and whether they are active are application/domain rules
 * enforced by `KnockoutBracketService`, not by Zod.
 */
/**
 * Knockout-bracket generation request.
 *
 * Two mutually exclusive shapes, matching `GenerateKnockoutBracketCommand`:
 *
 * - `entryIds` - the caller-controlled ordering; entries pair in the supplied
 *   order into round 1 (no automatic seeding).
 * - `pairings` - explicit first-round pairings, where `second` may be `null`
 *   for a bye. Used when the caller has seeded the qualifiers.
 *
 * Whether the entries belong to the stage's category and whether the stage
 * already has a bracket are application/domain rules.
 */
export const generateKnockoutBracketInputSchema = z
  .object({
    entryIds: z
      .array(z.uuid('Each entry id must be a UUID.'))
      .min(1, 'Provide at least one entry.')
      .optional(),
    pairings: z
      .array(
        z.object({
          first: z.uuid('Each entry id must be a UUID.'),
          second: z.uuid('Each entry id must be a UUID.').nullable(),
        }),
      )
      .min(1, 'Provide at least one pairing.')
      .optional(),
  })
  .refine(
    (value) => (value.entryIds === undefined) !== (value.pairings === undefined),
    'Provide either entryIds or pairings, but not both.',
  );

/**
 * Group-fixture generation request.
 *
 * Only the request *shape* is validated here: a list of at least two entry
 * UUIDs (a round-robin needs someone to play). Whether the entries belong to the
 * stage's category, whether they are active and whether the stage already has
 * fixtures are application/domain rules enforced by `GroupFixtureService`.
 */
export const generateGroupFixturesInputSchema = z.object({
  entryIds: z
    .array(z.uuid('Each entry id must be a UUID.'))
    .min(2, 'A round-robin needs at least two entries.'),
});

/**
 * A single game in a match result.
 *
 * Only the request *shape* is validated here: the game number is 1-3 (best of
 * three) and each point value is a whole number between 0 and 30 (the game
 * ceiling). Whether the combination is a legal badminton score - a 21-point
 * target, a two-point margin, best-of-three completeness - is a domain rule
 * enforced by `scoreMatchGames` in the application layer.
 */
export const recordMatchGameInputSchema = z.object({
  gameNumber: positiveIntegerSchema.max(3, 'A match is best of three games (game number 1-3).'),
  participant1Points: z.coerce
    .number()
    .int('Points must be a whole number.')
    .min(0, 'Points cannot be negative.')
    .max(30, 'A game cannot exceed 30 points.'),
  participant2Points: z.coerce
    .number()
    .int('Points must be a whole number.')
    .min(0, 'Points cannot be negative.')
    .max(30, 'A game cannot exceed 30 points.'),
});

export const recordMatchResultInputSchema = z.object({
  games: z
    .array(recordMatchGameInputSchema)
    .min(1, 'A result must contain at least one game.')
    .max(3, 'A match is best of three games.'),
});

export type CreateTournamentInput = z.input<typeof createTournamentInputSchema>;
export type UpdateTournamentInput = z.input<typeof updateTournamentInputSchema>;
export type CreateCategoryInput = z.input<typeof createCategoryInputSchema>;
export type UpdateCategoryInput = z.input<typeof updateCategoryInputSchema>;
export type CreatePlayerInput = z.input<typeof createPlayerInputSchema>;
export type UpdatePlayerInput = z.input<typeof updatePlayerInputSchema>;
export type CreateTeamInput = z.input<typeof createTeamInputSchema>;
export type UpdateTeamInput = z.input<typeof updateTeamInputSchema>;
export type AddTeamMemberInput = z.input<typeof addTeamMemberInputSchema>;
export type RemoveTeamMemberInput = z.input<typeof removeTeamMemberInputSchema>;
export type RegisterTournamentEntryInput = z.input<typeof registerTournamentEntryInputSchema>;
export type UpdateTournamentEntryInput = z.input<typeof updateTournamentEntryInputSchema>;
export type CreateStageInput = z.input<typeof createStageInputSchema>;
export type UpdateStageInput = z.input<typeof updateStageInputSchema>;
export type CreateMatchInput = z.input<typeof createMatchInputSchema>;
export type UpdateMatchInput = z.input<typeof updateMatchInputSchema>;
export type AddMatchParticipantInput = z.input<typeof addMatchParticipantInputSchema>;
export type RecordMatchGameInput = z.input<typeof recordMatchGameInputSchema>;
export type RecordMatchResultInput = z.input<typeof recordMatchResultInputSchema>;
export type GenerateKnockoutBracketInput = z.input<typeof generateKnockoutBracketInputSchema>;
export type GenerateGroupFixturesInput = z.input<typeof generateGroupFixturesInputSchema>;
