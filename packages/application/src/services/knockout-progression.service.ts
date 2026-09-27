import {
  BusinessRuleViolationError,
  calculateNextBracketPosition,
  ConflictError,
  NotFoundError,
  type Match,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';

/**
 * Knockout progression.
 *
 * Propagates the winner of a completed knockout match into the correct slot of
 * the following round. It holds no state of its own: the caller supplies the
 * repository client, so `MatchResultService` can pass its *transactional*
 * client and keep the result, the winner and the progression atomic. Reading
 * the completed match through the same transaction is what makes idempotent
 * replay and concurrency safety work.
 *
 * Progression is **idempotent**: if the destination slot already holds the
 * winner the call is a no-op, so replaying a completed match never corrupts the
 * next round. If the slot holds a *different* entry the bracket is internally
 * inconsistent and the call fails with a conflict.
 *
 * This is safe to call from `MatchResultService` for every match: a match in a
 * non-KNOCKOUT stage is simply not part of a bracket and returns `false`.
 */
export interface KnockoutProgressionService {
  /**
   * Places `winnerEntryId` into the next-round slot for a completed knockout
   * match, using the given repository client. Returns `true` when a slot was
   * written and `false` when nothing changed (a non-knockout stage, the final,
   * or an already-propagated winner).
   */
  progress(client: RepositoryClient, matchId: string, winnerEntryId: string): Promise<boolean>;
}

export function createKnockoutProgressionService(): KnockoutProgressionService {
  return {
    async progress(client, matchId, winnerEntryId): Promise<boolean> {
      const match = requireCompletedWinner(
        matchId,
        winnerEntryId,
        await client.matches.findById(matchId),
      );

      const stage = await client.stages.findById(match.stageId);
      if (!stage) {
        throw new NotFoundError('Stage', match.stageId);
      }
      if (stage.type !== 'KNOCKOUT') {
        // Called automatically from result recording, so a GROUP (or other)
        // stage is simply not part of a bracket: nothing to advance.
        return false;
      }

      const bracketSize = stage.drawSize;
      if (bracketSize === null) {
        return false;
      }

      // Only bracket-generated matches carry a round and match number. A match
      // created directly on a KNOCKOUT stage (Phase 5 style) has no position in
      // the bracket, so there is nothing to advance.
      if (match.roundNumber === null || match.matchNumber === null) {
        return false;
      }

      const position = calculateNextBracketPosition(match.roundNumber, match.matchNumber);
      const finalRound = Math.log2(bracketSize);
      if (position.roundNumber > finalRound) {
        // The final's winner is the champion; there is no next match.
        return false;
      }

      const nextMatch = await findMatchByRoundAndNumber(client, match.stageId, position);
      const existing = await client.matchParticipants.findSlot(nextMatch.id, position.slot);

      if (existing) {
        if (existing.entryId === winnerEntryId) {
          // Already propagated (idempotent replay).
          return false;
        }
        throw new ConflictError('The destination slot is already occupied by a different entry.');
      }

      // Fill-only: the destination slot is empty, so create the participant.
      // `fillSlot` cannot overwrite, so if another winner claims the same slot
      // concurrently the unique index makes the loser fail as a conflict rather
      // than replacing the entry already there.
      await client.matchParticipants.fillSlot(nextMatch.id, position.slot, winnerEntryId);
      return true;
    },
  };
}

/** Validates the match and winner up front so every caller shares the rules. */
function requireCompletedWinner(
  matchId: string,
  winnerEntryId: string,
  match: Match | undefined,
): Match {
  if (!match) {
    throw new NotFoundError('Match', matchId);
  }
  if (match.status !== 'COMPLETED') {
    throw new BusinessRuleViolationError('Only a completed knockout match can progress a winner.');
  }
  if (!match.winnerEntryId || match.winnerEntryId !== winnerEntryId) {
    throw new BusinessRuleViolationError(
      'The propagated entry must be the recorded winner of the completed match.',
    );
  }
  return match;
}

/**
 * Finds the destination match within the stage, without a per-match query: the
 * stage's matches are loaded once and filtered in memory.
 */
async function findMatchByRoundAndNumber(
  client: RepositoryClient,
  stageId: string,
  position: { readonly roundNumber: number; readonly matchNumber: number },
): Promise<Match> {
  const matches = await client.matches.listByStage(stageId);
  const next = matches.find(
    (candidate) =>
      candidate.roundNumber === position.roundNumber &&
      candidate.matchNumber === position.matchNumber,
  );
  if (!next) {
    throw new BusinessRuleViolationError(
      `No match exists at round ${position.roundNumber}, number ${position.matchNumber}.`,
    );
  }
  return next;
}
