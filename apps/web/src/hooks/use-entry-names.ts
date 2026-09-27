import { useMemo } from 'react';

import { useApi } from '@/api/context.tsx';
import type { EntryDto } from '@/api/types.ts';
import { useApiQuery } from '@/hooks/use-api-query.ts';
import { useCompetitorNames } from '@/hooks/use-competitor-names.ts';

/**
 * Resolves competitor names for entry ids in a category.
 *
 * Uses the existing per-category entry list plus the player/team name lookup,
 * so standings can show names without a new collection endpoint. Unknown ids
 * fall back to a shortened id so a row is never blank.
 */
export function useEntryNames(categoryId: string): {
  readonly nameFor: (entryId: string) => string;
  readonly entries: readonly EntryDto[];
} {
  const api = useApi();
  const entriesQuery = useApiQuery<readonly EntryDto[]>(['entries', categoryId], (signal) =>
    api.entries.listByCategory(categoryId, signal),
  );

  const entries = useMemo(
    () => (entriesQuery.state.status === 'loaded' ? entriesQuery.state.data : []),
    [entriesQuery.state],
  );
  const { playerNames, teamNames } = useCompetitorNames(
    entries.map((entry) => entry.playerId).filter((id): id is string => id !== null),
    entries.map((entry) => entry.teamId).filter((id): id is string => id !== null),
  );

  const nameFor = useMemo(() => {
    return (entryId: string): string => {
      const entry = entries.find((candidate) => candidate.id === entryId);
      if (!entry) {
        return `${entryId.slice(0, 8)}…`;
      }
      if (entry.playerId) {
        return playerNames[entry.playerId] ?? 'Unknown player';
      }
      if (entry.teamId) {
        return teamNames[entry.teamId] ?? 'Unknown team';
      }
      return `${entryId.slice(0, 8)}…`;
    };
  }, [entries, playerNames, teamNames]);

  return { nameFor, entries };
}
