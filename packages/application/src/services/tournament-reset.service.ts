import { ConflictError, NotFoundError, type Match, type Tournament } from '@badminton/domain';

import { REALTIME_AGGREGATES, REALTIME_EVENTS } from '../realtime/event-types.ts';
import type { RealtimeEventService } from '../realtime/event.service.ts';
import type { UnitOfWork } from '../repositories/unit-of-work.ts';
import type { TournamentResetSummary } from './tournament-backup.ts';

/**
 * Guarded tournament reset.
 *
 * A destructive operator operation on a **non-terminal** tournament: in one
 * `UnitOfWork.runInTransaction` it clears every match's result and schedule
 * (deletes the stored games, clears the winner, returns the match to
 * `SCHEDULED` and nulls the court and times) and reopens every `ACTIVE` or
 * `COMPLETED` stage to `PENDING`, so a tournament can be re-played without
 * deleting it. A `COMPLETED` or `CANCELLED` tournament is refused with
 * `ConflictError`; an unknown id raises `NotFoundError`.
 *
 * The setup is untouched: entries, categories, courts and the tournament's own
 * status survive. Reopening a `COMPLETED` stage uses a direct `updateStatus`
 * (`STAGE_TRANSITIONS` has no `COMPLETED → PENDING` edge), the same mechanism
 * the knockout correction uses.
 *
 * The existing `MATCH_UNSCHEDULED` event is recorded for each match whose
 * schedule is cleared and `STAGE_STATUS_CHANGED` for each stage reopened, on
 * the transaction client, so the business change and its notifications commit
 * together. No new event type is introduced. The operation is idempotent: a
 * second reset finds every match already `SCHEDULED` with no schedule and every
 * stage already `PENDING`, so it changes nothing and writes no event.
 */
export interface TournamentResetService {
  reset(tournamentId: string): Promise<TournamentResetSummary>;
}

export function createTournamentResetService(
  unitOfWork: UnitOfWork,
  events: RealtimeEventService,
): TournamentResetService {
  return {
    async reset(tournamentId): Promise<TournamentResetSummary> {
      return unitOfWork.runInTransaction(async (tx) => {
        const tournament = await tx.tournaments.findById(tournamentId);
        if (!tournament) {
          throw new NotFoundError('Tournament', tournamentId);
        }
        assertResettable(tournament);

        const [matches, stages] = await Promise.all([
          tx.matches.listByTournament(tournamentId),
          tx.stages.listByTournament(tournamentId),
        ]);

        let matchesReset = 0;
        for (const match of matches) {
          // A match that is already fully reset is left untouched, so a second
          // reset writes no match row and records no event.
          if (!needsReset(match)) {
            continue;
          }
          await tx.matchGames.deleteByMatch(match.id);
          await tx.matches.reset(match.id);
          matchesReset += 1;

          if (match.courtId !== null) {
            await events.record(tx, {
              tournamentId,
              eventType: REALTIME_EVENTS.MATCH_UNSCHEDULED,
              aggregateType: REALTIME_AGGREGATES.MATCH,
              aggregateId: match.id,
            });
          }
        }

        let stagesReopened = 0;
        for (const stage of stages) {
          if (stage.status !== 'ACTIVE' && stage.status !== 'COMPLETED') {
            continue;
          }
          await tx.stages.updateStatus(stage.id, 'PENDING');
          stagesReopened += 1;
          await events.record(tx, {
            tournamentId,
            eventType: REALTIME_EVENTS.STAGE_STATUS_CHANGED,
            aggregateType: REALTIME_AGGREGATES.STAGE,
            aggregateId: stage.id,
          });
        }

        return { tournamentId, matchesReset, stagesReopened };
      });
    },
  };
}

/** Terminal tournaments are read-only, so they cannot be reset. */
function assertResettable(tournament: Tournament): void {
  if (tournament.status === 'COMPLETED' || tournament.status === 'CANCELLED') {
    throw new ConflictError(`A ${tournament.status.toLowerCase()} tournament cannot be reset.`);
  }
}

/** True when the match still holds a result, a schedule or a non-initial status. */
function needsReset(match: Match): boolean {
  return (
    match.status !== 'SCHEDULED' ||
    match.winnerEntryId !== null ||
    match.courtId !== null ||
    match.scheduledStartAt !== null ||
    match.scheduledEndAt !== null
  );
}
