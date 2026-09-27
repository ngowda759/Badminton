/**
 * Infrastructure layer.
 *
 * Implements the application's repository ports on top of Prisma and adapts the
 * existing `PrismaClient` to the application's transaction port. Business rules
 * and HTTP concerns do not belong here.
 */
export { createPrismaUnitOfWork, createRepositoryClient } from './repositories.ts';
export { toApplicationError, translatePersistenceErrors } from './errors.ts';
export {
  createPostgresRealtimeEventNotifier,
  type PostgresNotifierOptions,
} from './realtime-notifier.ts';
