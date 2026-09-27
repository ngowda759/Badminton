import {
  ACTIVE_ENTRY_STATUSES,
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
 * **of the requested stage**, resolves each match's two participants and its
 * games in two batched queries (no N+1), then hands the data to the pure
 * `calculateStandings` domain function.
 *
 * Only active entries of the stage's category appear in the table - a
 * withdrawn or disqualified entry is excluded even if it played earlier
 * matches - and every active entry appears from zero before it has played, so
 * an operator sees the full group from the start.
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
      // Standings are scoped to the stage and its active competitors only: a
      // withdrawn or disqualified entry no longer occupies a place, so it must
      // not appear in the table even if it played earlier matches.
      const activeEntryIds = entries
        .filter((entry) => ACTIVE_ENTRY_STATUSES.includes(entry.status))
        .map((entry) => entry.id);

      const completed = await client.matches.listCompletedByStage(stageId);
      if (completed.length === 0) {
        return calculateStandings(activeEntryIds, []);
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

      // The pure function defensively includes any entry it finds in a match,
      // so drop rows for entries that are no longer active - a completed result
      // must not resurrect a withdrawn competitor in the table.
      const active = new Set(activeEntryIds);
      const rows = calculateStandings(activeEntryIds, matches).filter((row) =>
        active.has(row.entryId),
      );

      return rows.map((row, index) => ({ ...row, position: index + 1 }));
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
