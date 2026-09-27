import { useEffect, useState } from 'react';

import { useApi } from '@/api/context.tsx';

/**
 * Resolves player and team names for entry rows.
 *
 * Entries reference a competitor by id only, and Phase 3 exposes no bulk lookup
 * or collection endpoint, so names are fetched per id and cached for the life
 * of the page. Ids are de-duplicated before fetching, so several entries that
 * share a competitor cost one request.
 */
export interface NameLookup {
  readonly playerNames: Readonly<Record<string, string>>;
  readonly teamNames: Readonly<Record<string, string>>;
}

export function useCompetitorNames(
  playerIds: readonly string[],
  teamIds: readonly string[],
): NameLookup {
  const api = useApi();
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});

  // Join the ids into a stable key so the effect re-runs only on real changes.
  const playersKey = [...new Set(playerIds)].sort().join(',');
  const teamsKey = [...new Set(teamIds)].sort().join(',');

  useEffect(() => {
    const controller = new AbortController();
    const ids = playersKey ? playersKey.split(',') : [];

    void Promise.all(
      ids.map(async (id) => {
        try {
          const player = await api.players.get(id, controller.signal);
          return [id, player.name] as const;
        } catch {
          return [id, 'Unknown player'] as const;
        }
      }),
    ).then((entries) => {
      if (!controller.signal.aborted) {
        setPlayerNames(Object.fromEntries(entries));
      }
    });

    return () => {
      controller.abort();
    };
  }, [api, playersKey]);

  useEffect(() => {
    const controller = new AbortController();
    const ids = teamsKey ? teamsKey.split(',') : [];

    void Promise.all(
      ids.map(async (id) => {
        try {
          const team = await api.teams.get(id, controller.signal);
          return [id, team.name] as const;
        } catch {
          return [id, 'Unknown team'] as const;
        }
      }),
    ).then((entries) => {
      if (!controller.signal.aborted) {
        setTeamNames(Object.fromEntries(entries));
      }
    });

    return () => {
      controller.abort();
    };
  }, [api, teamsKey]);

  return { playerNames, teamNames };
}
