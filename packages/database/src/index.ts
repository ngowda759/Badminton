/**
 * Persistence layer.
 *
 * Owns the Prisma client, its lifecycle and the database-facing ports that
 * the API depends on. Route handlers never import this package directly -
 * they go through a service (see `apps/api/src/services`).
 */
export { connectDatabase, type DatabaseConnection } from './connection.ts';
export { createDatabaseHealthCheck, type DatabaseHealthCheckOptions } from './health-check.ts';
export { createPrismaDatabaseProbe, type DatabaseProbe } from './probe.ts';
export { createPrismaClient } from './prisma-client.ts';
export { Prisma, PrismaClient } from '../generated/prisma/client.ts';
export type {
  Match as PrismaMatch,
  MatchParticipant as PrismaMatchParticipant,
  Player as PrismaPlayer,
  Team as PrismaTeam,
  TeamMember as PrismaTeamMember,
  Tournament as PrismaTournament,
  TournamentCategory as PrismaTournamentCategory,
  TournamentEntry as PrismaTournamentEntry,
  TournamentStage as PrismaTournamentStage,
} from '../generated/prisma/client.ts';
export type { TransactionClient } from '../generated/prisma/internal/prismaNamespace.ts';
