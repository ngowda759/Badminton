import {
  BusinessRuleViolationError,
  ConflictError,
  isValidScheduleRange,
  NotFoundError,
  type Court,
  type Match,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type { ScheduleMatchCommand } from './commands.ts';

/**
 * Match scheduling service.
 *
 * The operator decides where and when a match is played; this service only
 * guarantees the decision is valid. It assigns a court and a bounded
 * `[start, end)` interval to a match that is still schedulable, and it clears
 * that information again while the match is still in the future.
 *
 * It deliberately does not: calculate standings, drive knockout progression,
 * record scores or choose winners - those remain with the existing services.
 *
 * Reads and a single write are involved, so no interactive transaction is
 * opened. The scheduling overlap rule is enforced by a PostgreSQL GiST
 * exclusion constraint, which is the final boundary when two operators race;
 * the pre-check here exists only to return a friendly error.
 */
export interface MatchSchedulingService {
  /** Assigns a court and a start/end window to a SCHEDULED match. */
  schedule(matchId: string, command: ScheduleMatchCommand): Promise<Match>;
  /** Clears the court and window of a SCHEDULED match. */
  unschedule(matchId: string): Promise<Match>;
}

export function createMatchSchedulingService(client: RepositoryClient): MatchSchedulingService {
  return {
    async schedule(matchId: string, command: ScheduleMatchCommand): Promise<Match> {
      const match = await requireMatch(client, matchId);

      assertSchedulable(match);

      if (!isValidScheduleRange(command.scheduledStartAt, command.scheduledEndAt)) {
        throw new BusinessRuleViolationError(
          'A schedule must start before it ends; zero-length and reversed windows are invalid.',
        );
      }

      const court = await requireCourt(client, command.courtId);
      const tournamentId = await resolveTournamentId(client, match);

      if (court.tournamentId !== tournamentId) {
        throw new BusinessRuleViolationError(
          'The court does not belong to the same tournament as the match.',
        );
      }

      if (court.status !== 'ACTIVE') {
        throw new BusinessRuleViolationError('An inactive court cannot receive a new schedule.');
      }

      const overlap = await client.matches.findOverlappingSchedule(
        court.id,
        command.scheduledStartAt,
        command.scheduledEndAt,
        match.id,
      );
      if (overlap) {
        throw new ConflictError('This court already has a match overlapping that time.');
      }

      return client.matches.schedule(match.id, {
        courtId: court.id,
        scheduledStartAt: command.scheduledStartAt,
        scheduledEndAt: command.scheduledEndAt,
      });
    },

    async unschedule(matchId: string): Promise<Match> {
      const match = await requireMatch(client, matchId);

      if (match.status !== 'SCHEDULED') {
        throw new ConflictError('Only a scheduled match can be cleared.');
      }

      return client.matches.unschedule(match.id);
    },
  };
}

/**
 * A match may only be (re)scheduled while it is `SCHEDULED`.
 *
 * An `IN_PROGRESS` match must not move while it is being played; a `COMPLETED`
 * match is immutable from the scheduling perspective; a `CANCELLED` match must
 * not receive a schedule.
 */
function assertSchedulable(match: Match): void {
  if (match.status === 'IN_PROGRESS') {
    throw new ConflictError('An in-progress match cannot be rescheduled.');
  }
  if (match.status === 'COMPLETED') {
    throw new ConflictError('A completed match cannot be rescheduled.');
  }
  if (match.status === 'CANCELLED') {
    throw new ConflictError('A cancelled match cannot be scheduled.');
  }
}

async function requireMatch(client: RepositoryClient, id: string): Promise<Match> {
  const match = await client.matches.findById(id);
  if (!match) {
    throw new NotFoundError('Match', id);
  }
  return match;
}

async function requireCourt(client: RepositoryClient, id: string): Promise<Court> {
  const court = await client.courts.findById(id);
  if (!court) {
    throw new NotFoundError('Court', id);
  }
  return court;
}

/** Resolves the owning tournament through the match → stage → category chain. */
async function resolveTournamentId(client: RepositoryClient, match: Match): Promise<string> {
  const stage = await client.stages.findById(match.stageId);
  if (!stage) {
    throw new NotFoundError('Stage', match.stageId);
  }
  const category = await client.categories.findById(stage.categoryId);
  if (!category) {
    throw new NotFoundError('Category', stage.categoryId);
  }
  return category.tournamentId;
}
