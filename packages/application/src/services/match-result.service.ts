import {
  BusinessRuleViolationError,
  ConflictError,
  determineMatchOutcome,
  NotFoundError,
  scoreMatchGames,
  type Match,
  type MatchGame,
  type MatchResult,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type { UnitOfWork } from '../repositories/unit-of-work.ts';
import type { RecordMatchResultCommand } from './commands.ts';

/**
 * Match result and scoring service.
 *
 * Recording a result is the only multi-row write in Phase 5 and is therefore
 * transactional: the match is validated, exactly two participants are required,
 * the games are scored by the domain rules, the result is persisted and the
 * match is moved to `COMPLETED` - all inside one unit of work, so a failure
 * leaves no partial result.
 *
 * The service depends only on repository ports and the pure domain rules; it
 * knows nothing about HTTP or React.
 */
export interface MatchResultService {
  recordResult(matchId: string, command: RecordMatchResultCommand): Promise<MatchResult>;
  /** The stored result of a completed match, or `undefined` if it is not complete. */
  getResult(matchId: string): Promise<MatchResult | undefined>;
}

export function createMatchResultService(
  client: RepositoryClient,
  unitOfWork: UnitOfWork,
): MatchResultService {
  return {
    async recordResult(matchId, command): Promise<MatchResult> {
      // Shape and scoring validity are pure domain concerns, so validate before
      // opening a transaction: an invalid score never reaches the database.
      const games = scoreMatchGames(command.games);

      return unitOfWork.runInTransaction(async (tx) => {
        const match = await tx.matches.findById(matchId);
        if (!match) {
          throw new NotFoundError('Match', matchId);
        }

        // Lifecycle: only an in-progress match may receive a result. A
        // completed match is immutable (so a concurrent second completion is a
        // conflict) and a cancelled or scheduled match cannot be scored.
        if (match.status === 'COMPLETED') {
          throw new ConflictError('This match is already completed.');
        }
        if (match.status !== 'IN_PROGRESS') {
          throw new BusinessRuleViolationError(
            'The match must be in progress before a result can be recorded.',
          );
        }

        const participants = await tx.matchParticipants.listByMatch(matchId);
        const slot1 = participants.find((participant) => participant.slot === 1);
        const slot2 = participants.find((participant) => participant.slot === 2);
        if (!slot1 || !slot2) {
          throw new BusinessRuleViolationError(
            'A match must have exactly two participants before it can be scored.',
          );
        }

        const savedGames = await tx.matchGames.createMany(
          games.map((game) => ({ matchId, ...game })),
        );

        const outcome = determineMatchOutcome(games);
        const winnerEntryId = outcome.winnerSlot === 1 ? slot1.entryId : slot2.entryId;
        const loserEntryId = outcome.winnerSlot === 1 ? slot2.entryId : slot1.entryId;

        const completed = await tx.matches.complete(matchId, winnerEntryId);
        return toResult(completed, winnerEntryId, loserEntryId, savedGames);
      });
    },

    async getResult(matchId): Promise<MatchResult | undefined> {
      const match = await client.matches.findById(matchId);
      if (!match) {
        throw new NotFoundError('Match', matchId);
      }
      if (match.status !== 'COMPLETED') {
        return undefined;
      }

      const participants = await client.matchParticipants.listByMatch(matchId);
      const games = await client.matchGames.listByMatch(matchId);
      const slot1 = participants.find((participant) => participant.slot === 1);
      const slot2 = participants.find((participant) => participant.slot === 2);
      if (!slot1 || !slot2 || !match.winnerEntryId) {
        throw new BusinessRuleViolationError(
          'A completed match must have two participants and a recorded winner.',
        );
      }

      const loserEntryId = match.winnerEntryId === slot1.entryId ? slot2.entryId : slot1.entryId;
      return toResult(match, match.winnerEntryId, loserEntryId, games);
    },
  };
}

function toResult(
  match: Match,
  winnerEntryId: string,
  loserEntryId: string,
  games: readonly MatchGame[],
): MatchResult {
  const outcome = determineMatchOutcome(games);
  return {
    matchId: match.id,
    winnerSlot: outcome.winnerSlot,
    winnerEntryId,
    loserEntryId,
    winnerGames: outcome.winnerGames,
    loserGames: outcome.loserGames,
    games,
  };
}
