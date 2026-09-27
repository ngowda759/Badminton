import {
  BusinessRuleViolationError,
  calculateStandings,
  NotFoundError,
  type MatchParticipant,
  type StandingRow,
  type StandingsMatch,
  type StandingsParticipant,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';

/**
 * Group standings service.
 *
 * Standings are derived, never stored: the service reads the completed matches
 * of a stage's category, resolves each match's two participants and its games
 * in two batched queries (no N+1), then hands the data to the pure
 * `calculateStandings` domain function.
 *
 * Every active entry in the category appears in the table, even before it has
 * played, so an operator sees the full group from the start.
 */
export interface StandingsService {
  /** Standings for a GROUP stage. Throws for a non-group stage. */
  getStageStandings(stageId: string): Promise<readonly StandingRow[]>;
}

export function createStandingsService(client: RepositoryClient): StandingsService {
  return {
    async getStageStandings(stageId: string): Promise<readonly StandingRow[]> {
      const stage = await client.stages.findById(stageId);
      if (!stage) {
        throw new NotFoundError('Stage', stageId);
      }
      if (stage.type !== 'GROUP') {
        throw new BusinessRuleViolationError('Standings are only available for a GROUP stage.');
      }

      const entries = await client.entries.listByCategory(stage.categoryId);
      const entryIds = entries.map((entry) => entry.id);

      const completed = await client.matches.listCompletedByCategory(stage.categoryId);
      if (completed.length === 0) {
        return calculateStandings(entryIds, []);
      }

      const matchIds = completed.map((match) => match.id);
      const participants = await client.matchParticipants.listByMatchIds(matchIds);
      const games = await client.matchGames.listByMatchIds(matchIds);

      const participantsByMatch = groupBy(participants, (participant) => participant.matchId);
      const gamesByMatch = groupBy(games, (game) => game.matchId);

      const matches: StandingsMatch[] = completed.map((match) => ({
        participants: toStandingsParticipants(participantsByMatch.get(match.id) ?? []),
        games: gamesByMatch.get(match.id) ?? [],
      }));

      return calculateStandings(entryIds, matches);
    },
  };
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const groupKey = key(row);
    const bucket = grouped.get(groupKey);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(groupKey, [row]);
    }
  }
  return grouped;
}

function toStandingsParticipants(
  rows: readonly MatchParticipant[],
): readonly StandingsParticipant[] {
  return rows.map((row) => ({ entryId: row.entryId, slot: row.slot }));
}
