/**
 * Application layer.
 *
 * Services orchestrate the domain rules and depend only on repository ports
 * (and a transaction port); they never import Prisma, Fastify or HTTP types.
 * Persistence adapters implementing the ports live in `@badminton/infrastructure`.
 */
export type {
  RepositoryClient,
  CourtRepository,
  TournamentRepository,
  TournamentCategoryRepository,
  PlayerRepository,
  TeamRepository,
  TeamMemberRepository,
  TournamentEntryRepository,
  TournamentStageRepository,
  MatchRepository,
  MatchWithParticipants,
  MatchParticipantRepository,
  MatchGameRepository,
} from './repositories/index.ts';
export type {
  CreateCategoryData,
  CreateCourtData,
  CreateEntryData,
  CreateMatchData,
  CreateMatchGameData,
  CreateMatchParticipantData,
  MatchGameWithMatch,
  MatchScheduleData,
  CreatePlayerData,
  CreateStageData,
  CreateTeamData,
  CreateTeamMemberData,
  CreateTournamentData,
  UpdateCategoryData,
  UpdateCourtData,
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
  CreateCourtCommand,
  CreateMatchCommand,
  CreatePlayerCommand,
  CreateStageCommand,
  CreateTeamCommand,
  CreateTournamentCommand,
  GenerateKnockoutBracketCommand,
  GetKnockoutBracketQuery,
  RecordMatchGameCommand,
  RecordMatchResultCommand,
  RegisterEntryCommand,
  ScheduleMatchCommand,
  TransitionCategoryStatusCommand,
  TransitionCourtStatusCommand,
  TransitionMatchStatusCommand,
  TransitionStageStatusCommand,
  TransitionTournamentStatusCommand,
  UpdateCategoryCommand,
  UpdateCourtCommand,
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
export {
  createMatchResultService,
  type MatchResultService,
} from './services/match-result.service.ts';
export { createStandingsService, type StandingsService } from './services/standings.service.ts';
export {
  createKnockoutBracketService,
  type KnockoutBracketService,
} from './services/knockout-bracket.service.ts';
export {
  createKnockoutProgressionService,
  type KnockoutProgressionService,
} from './services/knockout-progression.service.ts';
export type {
  Bracket,
  BracketMatch,
  BracketParticipant,
  BracketRound,
} from './services/knockout.ts';
export { createCourtService, type CourtService } from './services/court.service.ts';
export {
  createMatchSchedulingService,
  type MatchSchedulingService,
} from './services/match-scheduling.service.ts';
export {
  createTournamentDashboardService,
  type TournamentDashboardService,
} from './services/tournament-dashboard.service.ts';
export type {
  DashboardCategoryProgress,
  DashboardCompetitor,
  DashboardCourt,
  DashboardMatch,
  DashboardStageProgress,
  DashboardSummary,
  TournamentDashboard,
} from './services/dashboard.ts';
