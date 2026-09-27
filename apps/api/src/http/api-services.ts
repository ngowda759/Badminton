import type {
  MatchService,
  PlayerService,
  TeamService,
  TournamentCategoryService,
  TournamentEntryService,
  TournamentService,
  TournamentStageService,
} from '@badminton/application';

/**
 * The set of application services the HTTP layer exposes.
 *
 * Routes depend on this interface, not on Prisma or the repository ports, so a
 * test can build the real Fastify app with fake services and exercise routing,
 * validation and error mapping without a database. Production composes the real
 * services over Prisma (see `composition/api-services.ts`).
 */
export interface ApiServices {
  readonly tournaments: TournamentService;
  readonly categories: TournamentCategoryService;
  readonly players: PlayerService;
  readonly teams: TeamService;
  readonly entries: TournamentEntryService;
  readonly stages: TournamentStageService;
  readonly matches: MatchService;
}
