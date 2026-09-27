import {
  createKnockoutBracketService,
  createKnockoutProgressionService,
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
 *
 * The knockout progression service is stateless; `MatchResultService` passes its
 * result transaction into it so the result and the next-round slot commit
 * together, while `KnockoutBracketService` is given the unit of work for its
 * multi-row bracket generation.
 */
export function createApiServices(client: RepositoryClient, unitOfWork: UnitOfWork): ApiServices {
  const progression = createKnockoutProgressionService();
  return {
    tournaments: createTournamentService(client),
    categories: createTournamentCategoryService(client),
    players: createPlayerService(client),
    teams: createTeamService(client, unitOfWork),
    entries: createTournamentEntryService(client, unitOfWork),
    stages: createTournamentStageService(client),
    matches: createMatchService(client, unitOfWork),
    matchResults: createMatchResultService(client, unitOfWork, progression),
    standings: createStandingsService(client),
    knockout: createKnockoutBracketService(client, unitOfWork),
  };
}
