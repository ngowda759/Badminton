import {
  BusinessRuleViolationError,
  ConflictError,
  isValidScheduleRange,
  NotFoundError,
  type Court,
  type Match,
} from '@badminton/domain';

import { REALTIME_AGGREGATES, REALTIME_EVENTS } from '../realtime/event-types.ts';
import type { RealtimeEventService } from '../realtime/event.service.ts';
import type { RepositoryClient } from '../repositories/index.ts';
import type { UnitOfWork } from '../repositories/unit-of-work.ts';
import type { ScheduleMatchCommand } from './commands.ts';
import { resolveMatchTournamentId } from './resolve-tournament.ts';

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
 * The schedule write and its realtime outbox event run in one `UnitOfWork`
 * transaction, so a committed schedule always has its `MATCH_SCHEDULED` (or
 * `MATCH_UNSCHEDULED`) event and a rollback writes neither. The scheduling
 * overlap rule is enforced by a PostgreSQL GiST exclusion constraint, which is
 * the final boundary when two operators race; the pre-check here exists only to
 * return a friendly error.
 */
export interface MatchSchedulingService {
  /** Assigns a court and a start/end window to a SCHEDULED match. */
  schedule(matchId: string, command: ScheduleMatchCommand): Promise<Match>;
  /** Clears the court and window of a SCHEDULED match. */
  unschedule(matchId: string): Promise<Match>;
}

export function createMatchSchedulingService(
  _client: RepositoryClient,
  unitOfWork: UnitOfWork,
  events: RealtimeEventService,
): MatchSchedulingService {
  return {
    async schedule(matchId: string, command: ScheduleMatchCommand): Promise<Match> {
      return unitOfWork.runInTransaction(async (tx) => {
        const match = await requireMatch(tx, matchId);

        assertSchedulable(match);

        if (!isValidScheduleRange(command.scheduledStartAt, command.scheduledEndAt)) {
          throw new BusinessRuleViolationError(
            'A schedule must start before it ends; zero-length and reversed windows are invalid.',
          );
        }

        const court = await requireCourt(tx, command.courtId);
        const tournamentId = await resolveMatchTournamentId(tx, match);

        if (court.tournamentId !== tournamentId) {
          throw new BusinessRuleViolationError(
            'The court does not belong to the same tournament as the match.',
          );
        }

        if (court.status !== 'ACTIVE') {
          throw new BusinessRuleViolationError('An inactive court cannot receive a new schedule.');
        }

        const overlap = await tx.matches.findOverlappingSchedule(
          court.id,
          command.scheduledStartAt,
          command.scheduledEndAt,
          match.id,
        );
        if (overlap) {
          throw new ConflictError('This court already has a match overlapping that time.');
        }

        const scheduled = await tx.matches.schedule(match.id, {
          courtId: court.id,
          scheduledStartAt: command.scheduledStartAt,
          scheduledEndAt: command.scheduledEndAt,
        });

        await events.record(tx, {
          tournamentId,
          eventType: REALTIME_EVENTS.MATCH_SCHEDULED,
          aggregateType: REALTIME_AGGREGATES.MATCH,
          aggregateId: match.id,
        });

        return scheduled;
      });
    },

    async unschedule(matchId: string): Promise<Match> {
      return unitOfWork.runInTransaction(async (tx) => {
        const match = await requireMatch(tx, matchId);

        if (match.status !== 'SCHEDULED') {
          throw new ConflictError('Only a scheduled match can be cleared.');
        }

        const tournamentId = await resolveMatchTournamentId(tx, match);
        const cleared = await tx.matches.unschedule(match.id);

        await events.record(tx, {
          tournamentId,
          eventType: REALTIME_EVENTS.MATCH_UNSCHEDULED,
          aggregateType: REALTIME_AGGREGATES.MATCH,
          aggregateId: match.id,
        });

        return cleared;
      });
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
