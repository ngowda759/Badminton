import type { StandingRow } from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import { computeStageStandings } from './standings-compute.ts';

/**
 * Group standings service.
 *
 * Standings are derived, never stored: the service delegates to the shared
 * `computeStageStandings`, which reads the completed matches **of the requested
 * stage**, resolves each match's two participants and its games in batched
 * queries (no N+1), then hands the data to the pure `calculateStandings` domain
 * function.
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
      return (await computeStageStandings(client, stageId)).rows;
    },
  };
}
