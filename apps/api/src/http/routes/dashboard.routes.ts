import type { TournamentDashboardService } from '@badminton/application';
import { tournamentIdParamSchema } from '@badminton/validation';
import type { FastifyPluginCallback } from 'fastify';

import { validate } from '../request.ts';
import { data } from '../response.ts';

export interface DashboardRoutesOptions {
  readonly dashboard: TournamentDashboardService;
}

/**
 * Tournament operational dashboard.
 *
 * One aggregated read endpoint: the client never reconstructs the dashboard
 * from many independent requests, and the service assembles it from a bounded
 * number of batched repository reads rather than an N+1 fan-out.
 */
export const dashboardRoutes: FastifyPluginCallback<DashboardRoutesOptions> = (app, options) => {
  const { dashboard } = options;

  app.get('/tournaments/:tournamentId/dashboard', async (request) => {
    const { tournamentId } = validate(tournamentIdParamSchema, request.params);
    return data(await dashboard.getDashboard(tournamentId));
  });
};
