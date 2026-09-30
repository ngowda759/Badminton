import {
  createCourtService,
  createGroupFixtureService,
  createKnockoutBracketService,
  createKnockoutProgressionService,
  createMatchResultService,
  createMatchSchedulingService,
  createMatchService,
  createPlayerService,
  createRealtimeEventService,
  createStandingsService,
  createTeamService,
  createTournamentCategoryService,
  createTournamentDashboardService,
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
 * Wires each service to the repository client, the unit of work (where an
 * operation is atomic) and the shared `RealtimeEventService` (Phase 8.3). This
 * is the only place the HTTP layer constructs services, so routes never reach
 * for Prisma and tests can inject fakes.
 *
 * The knockout progression service is stateless; `MatchResultService` passes its
 * result transaction into it so the result and the next-round slot commit
 * together, while `KnockoutBracketService` is given the unit of work for its
 * multi-row bracket generation. The same single `RealtimeEventService` instance
 * is handed to every event-publishing service: it is a stateless writer, so the
 * event is recorded on whatever transactional client the service passes it.
 */
export function createApiServices(client: RepositoryClient, unitOfWork: UnitOfWork): ApiServices {
  const progression = createKnockoutProgressionService();
  const events = createRealtimeEventService();
  return {
    tournaments: createTournamentService(client, unitOfWork, events),
    categories: createTournamentCategoryService(client, unitOfWork, events),
    players: createPlayerService(client),
    teams: createTeamService(client, unitOfWork),
    entries: createTournamentEntryService(client, unitOfWork, events),
    stages: createTournamentStageService(client, unitOfWork, events),
    matches: createMatchService(client, unitOfWork, events),
    matchResults: createMatchResultService(client, unitOfWork, events, progression),
    standings: createStandingsService(client),
    knockout: createKnockoutBracketService(client, unitOfWork),
    groupFixtures: createGroupFixtureService(unitOfWork),
    courts: createCourtService(client, unitOfWork, events),
    scheduling: createMatchSchedulingService(client, unitOfWork, events),
    dashboard: createTournamentDashboardService(client),
  };
}
