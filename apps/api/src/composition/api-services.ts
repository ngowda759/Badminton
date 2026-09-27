import {
  createMatchResultService,
  createMatchService,
  createPlayerService,
  createStandingsService,
  createTeamService,
  createTournamentCategoryService,
  createTournamentEntryService,
  createTournamentService,
  createTournamentStageService,
  type RepositoryClient,
  type UnitOfWork,
} from '@badminton/application';

import type { ApiServices } from '../http/api-services.ts';

/**
 * Composition root for the domain services.
 *
 * Wires each service to the repository client (and, where an operation is
 * atomic, the unit of work). This is the only place the HTTP layer constructs
 * services, so routes never reach for Prisma and tests can inject fakes.
 */
export function createApiServices(client: RepositoryClient, unitOfWork: UnitOfWork): ApiServices {
  return {
    tournaments: createTournamentService(client),
    categories: createTournamentCategoryService(client),
    players: createPlayerService(client),
    teams: createTeamService(client, unitOfWork),
    entries: createTournamentEntryService(client, unitOfWork),
    stages: createTournamentStageService(client),
    matches: createMatchService(client, unitOfWork),
    matchResults: createMatchResultService(client, unitOfWork),
    standings: createStandingsService(client),
  };
}
