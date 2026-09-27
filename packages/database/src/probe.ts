import type { PrismaClient } from '../generated/prisma/client.ts';

/**
 * Narrow port describing the only database capability the health path needs.
 *
 * Depending on this instead of `PrismaClient` keeps the health service free of
 * Prisma and lets tests supply a stub probe without a running database.
 */
export interface DatabaseProbe {
  ping(): Promise<void>;
}

/**
 * Wraps a Prisma client in the `DatabaseProbe` port.
 *
 * `SELECT 1` is the cheapest round trip that proves a usable connection: it
 * exercises pooling, authentication and the network path without touching
 * application tables.
 */
export function createPrismaDatabaseProbe(client: PrismaClient): DatabaseProbe {
  return {
    async ping(): Promise<void> {
      await client.$queryRaw`SELECT 1`;
    },
  };
}
