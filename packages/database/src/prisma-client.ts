import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.ts';

/**
 * Creates a Prisma client bound to PostgreSQL.
 *
 * Prisma 7 drives PostgreSQL through a driver adapter, so the connection
 * string is handed to `pg` rather than to the Prisma engine. The caller owns
 * the returned client and must call `$disconnect` when done.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
