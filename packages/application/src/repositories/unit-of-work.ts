import type { RepositoryClient } from './index.ts';

/**
 * Transaction boundary port.
 *
 * The application layer uses the existing Prisma interactive-transaction
 * facility indirectly: `runInTransaction` opens one `$transaction`, binds a
 * `RepositoryClient` to it and passes that client to `work`. Throwing from
 * `work` rolls the whole unit back. There is deliberately only this one
 * transaction mechanism in the codebase.
 */
export interface UnitOfWork {
  runInTransaction<T>(work: (client: RepositoryClient) => Promise<T>): Promise<T>;
}
