import type { PrismaClient } from '../generated/prisma/client.ts';
import { createPrismaClient } from './prisma-client.ts';
import { createPrismaDatabaseProbe, type DatabaseProbe } from './probe.ts';

/** Owns the Prisma client lifecycle for the API process. */
export interface DatabaseConnection {
  readonly probe: DatabaseProbe;
  /** The underlying client, for callers that need to run queries. */
  readonly prisma: PrismaClient;
  disconnect(): Promise<void>;
}

/** Opens a connection using the supplied PostgreSQL connection string. */
export function connectDatabase(connectionString: string): DatabaseConnection {
  const prisma = createPrismaClient(connectionString);

  return {
    probe: createPrismaDatabaseProbe(prisma),
    prisma,
    async disconnect(): Promise<void> {
      await prisma.$disconnect();
    },
  };
}
