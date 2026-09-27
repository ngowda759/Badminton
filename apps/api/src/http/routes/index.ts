import type { FastifyPluginAsync } from 'fastify';

import type { ApiServices } from '../api-services.ts';
import { categoryRoutes } from './category.routes.ts';
import { entryRoutes } from './entry.routes.ts';
import { playerRoutes } from './player.routes.ts';
import { stageMatchRoutes } from './stage-match.routes.ts';
import { teamRoutes } from './team.routes.ts';
import { tournamentRoutes } from './tournament.routes.ts';

/** API prefix for the tournament-domain resources. */
export const API_V1_PREFIX = '/api/v1';

/**
 * Mounts every `/api/v1` resource group behind a single prefix.
 *
 * Registered as an encapsulated plugin so the version prefix applies to all
 * routes at once and later versions can be added as sibling plugins without
 * touching the root composition.
 */
export function createApiV1Routes(services: ApiServices): FastifyPluginAsync {
  return async (instance) => {
    await instance.register(tournamentRoutes, {
      tournaments: services.tournaments,
      categories: services.categories,
    });
    await instance.register(categoryRoutes, { categories: services.categories });
    await instance.register(playerRoutes, { players: services.players });
    await instance.register(teamRoutes, { teams: services.teams });
    await instance.register(entryRoutes, { entries: services.entries });
    await instance.register(stageMatchRoutes, {
      stages: services.stages,
      matches: services.matches,
      matchResults: services.matchResults,
      standings: services.standings,
    });
  };
}
