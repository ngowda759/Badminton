/**
 * Application layer.
 *
 * Services orchestrate the domain rules and depend only on repository ports
 * (and a transaction port); they never import Prisma, Fastify or HTTP types.
 * Persistence adapters implementing the ports live in `@badminton/infrastructure`.
 */
export type {
  RepositoryClient,
  TournamentRepository,
  TournamentCategoryRepository,
  PlayerRepository,
  TeamRepository,
  TeamMemberRepository,
  TournamentEntryRepository,
  TournamentStageRepository,
  MatchRepository,
  MatchParticipantRepository,
} from './repositories/index.ts';
export type {
  CreateCategoryData,
  CreateEntryData,
  CreateMatchData,
  CreateMatchParticipantData,
  CreatePlayerData,
  CreateStageData,
  CreateTeamData,
  CreateTeamMemberData,
  CreateTournamentData,
  UpdateCategoryData,
  UpdateEntryData,
  UpdateMatchData,
  UpdatePlayerData,
  UpdateStageData,
  UpdateTeamData,
  UpdateTournamentData,
} from './repositories/data.ts';
export type { UnitOfWork } from './repositories/unit-of-work.ts';

export type {
  AddMatchParticipantCommand,
  AddTeamMemberCommand,
  CreateCategoryCommand,
  CreateMatchCommand,
  CreatePlayerCommand,
  CreateStageCommand,
  CreateTeamCommand,
  CreateTournamentCommand,
  RegisterEntryCommand,
  TransitionCategoryStatusCommand,
  TransitionMatchStatusCommand,
  TransitionStageStatusCommand,
  TransitionTournamentStatusCommand,
  UpdateCategoryCommand,
  UpdateEntryCommand,
  UpdateMatchCommand,
  UpdatePlayerCommand,
  UpdateStageCommand,
  UpdateTournamentCommand,
} from './services/commands.ts';

export { createTournamentService, type TournamentService } from './services/tournament.service.ts';
export {
  createTournamentCategoryService,
  type TournamentCategoryService,
} from './services/category.service.ts';
export { createPlayerService, type PlayerService } from './services/player.service.ts';
export { createTeamService, type TeamService } from './services/team.service.ts';
export {
  createTournamentEntryService,
  type TournamentEntryService,
} from './services/tournament-entry.service.ts';
export {
  createTournamentStageService,
  type TournamentStageService,
} from './services/stage.service.ts';
export { createMatchService, type MatchService } from './services/match.service.ts';
