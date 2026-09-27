import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma CLI configuration (Prisma 7 layout).
 *
 * `.env` is loaded before the config is evaluated because Prisma 7 resolves
 * `env('DATABASE_URL')` eagerly when this file is imported. Values already in
 * `process.env` win, so CI and container configuration stays authoritative.
 *
 * The `datasource` block is intentionally not defined in `schema.prisma`;
 * Prisma 7 takes the connection URL from here.
 *
 * Migrations prefer `DIRECT_URL` when present. Supabase (and other poolers) hand
 * out a transaction-pooled endpoint as `DATABASE_URL`, which cannot run DDL, plus
 * a direct endpoint as `DIRECT_URL`. Local Docker only defines `DATABASE_URL`, so
 * the fallback keeps the Phase 1 convention working unchanged.
 */
loadEnv({ path: ['.env.local', '.env'], quiet: true });

const migrationUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: migrationUrl ?? env('DATABASE_URL'),
  },
});
