import {
  BusinessRuleViolationError,
  calculateNextBracketPosition,
  isSupportedBracketSize,
  type Match,
  type MatchSlot,
} from '@badminton/domain';

import { REALTIME_AGGREGATES, REALTIME_EVENTS } from '../realtime/event-types.ts';
import type { RealtimeEventService } from '../realtime/event.service.ts';
import type { RepositoryClient } from '../repositories/index.ts';
import { resolveStageTournamentId } from './resolve-tournament.ts';

/**
 * Knockout bracket re-derivation for a corrected result.
 *
 * Correcting a completed knockout result changes who advances, so the bracket
 * must be re-derived from the corrected match downward. The operation holds no
 * state: the caller supplies its **transactional** client, so the corrected
 * result, the re-filled next-round slots, every reset downstream match and the
 * outbox events commit or roll back together.
 *
 * The cascade walks the corrected match's branch in **ascending round order**.
 * It carries the winner that should occupy the next round's slot: the corrected
 * match's new winner at the start, and `null` after a reset (a reset match has
 * no winner to advance). At each round it:
 *
 *   1. updates the incoming slot to that winner - clearing a stale occupant
 *      first, because `fillSlot` is create-only, or emptying it when the winner
 *      is unknown;
 *   2. when the match had already been decided, resets it (winner and games
 *      cleared, back to `IN_PROGRESS`) - its participants changed - and
 *      continues upward with an unknown winner.
 *
 * The walk stops as soon as the incoming slot already holds the winner that
 * belongs there: the participants did not change, so the bracket below is
 * consistent. A correction whose outcome did not change the winner therefore
 * re-derives nothing. A `COMPLETED` stage whose final is invalidated reopens to
 * `ACTIVE`, since the bracket is no longer decided.
 *
 * This is the write half of the correction. `MatchResultService.correctResult`
 * calls it inside the same unit of work, right after the corrected result is
 * re-completed.
 */
export interface KnockoutCorrectionService {
  /**
   * Re-derives the bracket below the corrected match, recording
   * `KNOCKOUT_MATCH_POPULATED` for each re-filled slot and `STAGE_STATUS_CHANGED`
   * when a completed stage reopens. Returns whether anything changed. A no-op
   * (returns `false`) when the match is not part of a generated bracket or its
   * outcome did not change the winner.
   */
  reopen(
    client: RepositoryClient,
    stageId: string,
    correctedMatchId: string,
    newWinnerEntryId: string,
  ): Promise<boolean>;
}

export function createKnockoutCorrectionService(
  events: RealtimeEventService,
): KnockoutCorrectionService {
  return {
    async reopen(client, stageId, correctedMatchId, newWinnerEntryId): Promise<boolean> {
      const stage = await client.stages.findById(stageId);
      if (!stage || stage.type !== 'KNOCKOUT') {
        return false;
      }
      const match = await client.matches.findById(correctedMatchId);
      if (!match) {
        return false;
      }
      // A standalone knockout match (no bracket position) has nothing downstream
      // to re-derive.
      if (match.roundNumber === null || match.matchNumber === null) {
        return false;
      }

      // A generated bracket records its draw size on the stage; without it there
      // is no final round to compare against, so nothing is re-derived.
      const bracketSize = stage.drawSize;
      if (bracketSize === null || !isSupportedBracketSize(bracketSize)) {
        return false;
      }

      const roundCount = Math.log2(bracketSize);
      const matches = await client.matches.listByStage(stage.id);
      const tournamentId = await resolveStageTournamentId(client, stage.id);

      let round: number = match.roundNumber;
      let matchNumber: number = match.matchNumber;
      // The winner that belongs in the next round's slot: the corrected match's
      // new winner, then `null` once a reset match has no winner to advance.
      let winner: string | null = newWinnerEntryId;
      let changed = false;

      while (round < roundCount) {
        const position = calculateNextBracketPosition(round, matchNumber);
        const destination = requireMatch(matches, position.roundNumber, position.matchNumber);
        const occupant = await slotEntry(client, destination.id, position.slot);

        if (winner !== null && occupant === winner) {
          // The slot already holds the winner that belongs there: the
          // participants did not change, so the bracket below is consistent.
          break;
        }

        if (winner !== null) {
          if (occupant) {
            await client.matchParticipants.clearSlot(destination.id, position.slot);
          }
          await client.matchParticipants.fillSlot(destination.id, position.slot, winner);
          changed = true;
          await events.record(client, {
            tournamentId,
            eventType: REALTIME_EVENTS.KNOCKOUT_MATCH_POPULATED,
            aggregateType: REALTIME_AGGREGATES.MATCH,
            aggregateId: destination.id,
          });
        } else if (occupant) {
          // The previous round's match was reset, so its old winner no longer
          // advances; empty the slot it occupied.
          await client.matchParticipants.clearSlot(destination.id, position.slot);
          changed = true;
        } else {
          // Nothing to fill or clear and nothing decided above.
          break;
        }

        if (destination.status !== 'COMPLETED' || !destination.winnerEntryId) {
          // An unplayed match simply received its competitor; the path ends.
          break;
        }

        // The destination's participants changed, so its result is stale: reset
        // it and continue upward with an unknown winner. No dedicated event is
        // needed for a reset match - the refresh bus refetches every registered
        // query on any event, and the immediate slot re-fill already recorded
        // `KNOCKOUT_MATCH_POPULATED`.
        await client.matchGames.deleteByMatch(destination.id);
        await client.matches.clearResult(destination.id);
        changed = true;

        winner = null;
        round = position.roundNumber;
        matchNumber = position.matchNumber;
      }

      // A stage is COMPLETED only once its final is decided. If this cascade
      // reset the final (its own result may have been the corrected one, or it
      // was reset as a downstream match), the stage must reopen so the bracket
      // can be completed again.
      if (changed && stage.status === 'COMPLETED') {
        const final = requireMatch(matches, roundCount, 1);
        const current = await client.matches.findById(final.id);
        if (current?.status !== 'COMPLETED') {
          await client.stages.updateStatus(stage.id, 'ACTIVE');
          await events.record(client, {
            tournamentId,
            eventType: REALTIME_EVENTS.STAGE_STATUS_CHANGED,
            aggregateType: REALTIME_AGGREGATES.STAGE,
            aggregateId: stage.id,
          });
        }
      }

      return changed;
    },
  };
}

function requireMatch(matches: readonly Match[], roundNumber: number, matchNumber: number): Match {
  const found = matches.find(
    (candidate) => candidate.roundNumber === roundNumber && candidate.matchNumber === matchNumber,
  );
  if (!found) {
    throw new BusinessRuleViolationError(
      `No match exists at round ${roundNumber}, number ${matchNumber}.`,
    );
  }
  return found;
}

/** The entry currently occupying `slot`, or `undefined`. */
async function slotEntry(
  client: RepositoryClient,
  matchId: string,
  slot: MatchSlot,
): Promise<string | undefined> {
  return (await client.matchParticipants.findSlot(matchId, slot))?.entryId;
}
