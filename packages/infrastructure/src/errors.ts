import {
  ConflictError,
  isApplicationError,
  PersistenceError,
  ValidationError,
} from '@badminton/domain';
import { Prisma } from '@badminton/database';

/**
 * Translates known Prisma/PostgreSQL failures into application errors.
 *
 * The database remains the final consistency boundary: a service pre-check can
 * still lose a race, so the unique-index violation that follows must surface as
 * a controlled `ConflictError` rather than a raw driver error. Messages here are
 * intentionally fixed and safe - constraint names and SQL are never returned.
 */

/** Known constraint/index names mapped to a caller-facing conflict message. */
const CONFLICT_MESSAGES: Readonly<Record<string, string>> = {
  tournaments_active_name_key: 'A live tournament with this name already exists.',
  tournament_categories_tournamentId_code_key:
    'A category with this code already exists in this tournament.',
  tournament_categories_name_key: 'A category with this name already exists in this tournament.',
  players_email_key: 'A player with this email address already exists.',
  players_phone_key: 'A player with this phone number already exists.',
  team_members_teamId_playerId_key: 'This player is already a member of the team.',
  entries_category_player_key: 'This player is already registered in this category.',
  entries_category_team_key: 'This team is already registered in this category.',
  tournament_stages_categoryId_sequence_key:
    'Another stage already occupies this sequence in this category.',
  matches_stageId_sequence_key: 'Another match already occupies this sequence in this stage.',
  match_participants_matchId_slot_key: 'This slot is already occupied in this match.',
  match_participants_matchId_entryId_key: 'This entry is already a participant in this match.',
  match_games_matchId_gameNumber_key: 'A result for this match has already been recorded.',
};

/**
 * Wraps `operation`, translating persistence failures.
 *
 * Application errors thrown by the operation itself pass through untouched so a
 * service's own `ConflictError`/`ValidationError` is preserved.
 */
export async function translatePersistenceErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (isApplicationError(error)) {
      throw error;
    }
    throw toApplicationError(error);
  }
}

/** Maps a raw error onto an application error, defaulting to `PersistenceError`. */
export function toApplicationError(error: unknown): Error {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = extractConstraintTarget(error);
      const message =
        (target && CONFLICT_MESSAGES[target]) ?? 'A record with these values already exists.';
      return new ConflictError(message);
    }
    if (error.code === 'P2003' || error.code === 'P2014') {
      return new ConflictError(
        'This operation would leave a referenced record in an invalid state.',
      );
    }
    return new PersistenceError();
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return new ValidationError('The persistence request was malformed.');
  }

  return new PersistenceError();
}

/**
 * Resolves the violated index from a P2002 error.
 *
 * Prisma reports the fields involved in `meta.target`; the driver adapter also
 * includes the underlying constraint name in the (internal-only) message. We
 * scan both for a known index name so the translation does not silently fall
 * back to a generic message.
 */
function extractConstraintTarget(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const candidates: string[] = [];

  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (typeof target === 'string') {
    candidates.push(target);
  } else if (Array.isArray(target)) {
    for (const part of target) {
      if (typeof part === 'string') {
        candidates.push(part);
      }
    }
  }

  candidates.push(error.message);

  return findKnownConstraint(candidates);
}

function findKnownConstraint(candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    if (candidate in CONFLICT_MESSAGES) {
      return candidate;
    }
    for (const name of Object.keys(CONFLICT_MESSAGES)) {
      if (candidate.includes(name)) {
        return name;
      }
    }
  }
  return undefined;
}
