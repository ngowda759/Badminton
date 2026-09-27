import { execFileSync } from 'node:child_process';

import { loadEnvironmentFiles } from '@badminton/config';
import { connectDatabase, type DatabaseConnection, type PrismaClient } from '@badminton/database';
import { Pool } from 'pg';

/**
 * Harness for the Phase 2 database integration tests.
 *
 * The suite runs against **real PostgreSQL** (no Prisma mocks) in a dedicated
 * `<database>_test` database, so a developer's normal database is never touched.
 * The test database is created and migrated on first use.
 *
 * Why a separate database rather than a `schema=` query parameter: `@prisma/adapter-pg`
 * ignores `schema=` on the connection string (`current_schema()` stays `public`), so
 * migrations landed in one schema while the client queried another.
 *
 * When no database is reachable the suite is skipped, so `npm test` still passes on a
 * machine without PostgreSQL - unless `CI` is set (or `REQUIRE_DATABASE_TESTS=1`), in
 * which case the suite fails loudly instead of silently skipping.
 */

export const TEST_SCHEMA = 'badminton_test';

function overrideDatabase(url: URL, database: string): string {
  url.pathname = `/${database}`;
  // The adapter ignores `schema=`, and a stale value would be misleading.
  url.searchParams.delete('schema');
  return url.toString();
}

/** Resolves the test database URL, deriving it from `DATABASE_URL` when not supplied. */
export function resolveTestDatabaseUrl(suffix = '_test'): string | undefined {
  // Vitest does not load `.env` for us; the repository loader keeps this
  // consistent with `npm run db:*` and the API.
  loadEnvironmentFiles();

  const configured = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!configured) {
    return undefined;
  }

  try {
    const url = new URL(configured);
    const database = url.pathname.replace(/^\//, '');
    const testDatabase = database.endsWith(suffix) ? database : `${database}${suffix}`;
    return overrideDatabase(url, testDatabase);
  } catch {
    return undefined;
  }
}

/** Connection string for the maintenance `postgres` database, used to create the test one. */
function resolveAdminDatabaseUrl(testUrl: string): string {
  return overrideDatabase(new URL(testUrl), 'postgres');
}

/** True when a missing database must fail the run rather than skip the suite. */
export function databaseTestsRequired(): boolean {
  return Boolean(process.env.CI) || process.env.REQUIRE_DATABASE_TESTS === '1';
}

function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

/** Ensures the test database exists, then applies migrations to it. */
async function prepareTestDatabase(testUrl: string): Promise<void> {
  const admin = new Pool({ connectionString: resolveAdminDatabaseUrl(testUrl), max: 1 });
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName(testUrl),
    ]);
    if (existing.rowCount === 0) {
      // Identifiers cannot be parameterised, so quote from a validated name.
      const name = databaseName(testUrl);
      if (!/^[A-Za-z0-9_]+$/.test(name)) {
        throw new Error(`Unsafe test database name: ${name}`);
      }
      await admin.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await admin.end();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
    timeout: 120_000,
  });
}

const prepared = new Map<string, Promise<void>>();

/** Runs `prepareTestDatabase` at most once per database URL per process. */
function ensureTestDatabase(testUrl: string): Promise<void> {
  const existing = prepared.get(testUrl);
  if (existing) {
    return existing;
  }

  const pending = prepareTestDatabase(testUrl).catch((error: unknown) => {
    prepared.delete(testUrl);
    throw error;
  });
  prepared.set(testUrl, pending);
  return pending;
}

/** An open connection to the migrated test database. */
export interface TestDatabase {
  readonly prisma: PrismaClient;
  disconnect(): Promise<void>;
}

/**
 * Opens a connection to the test database. Returns `undefined` (so the suite
 * skips) when PostgreSQL is absent and the run does not require it; throws when
 * the run requires a database but one cannot be prepared.
 *
 * `suffix` selects the database name derived from `DATABASE_URL`; suites that
 * mutate the same tables in parallel should pass a distinct suffix so they do
 * not interfere with each other.
 */
export async function openTestDatabase(suffix = '_test'): Promise<TestDatabase | undefined> {
  const url = resolveTestDatabaseUrl(suffix);
  if (!url) {
    if (databaseTestsRequired()) {
      throw new Error('DATABASE_URL is required to run the database integration tests.');
    }
    return undefined;
  }

  let connection: DatabaseConnection | undefined;
  try {
    await ensureTestDatabase(url);
    connection = connectDatabase(url);
    await connection.prisma.$queryRaw`SELECT 1 FROM "tournaments" LIMIT 0`;
  } catch (error: unknown) {
    await connection?.disconnect();
    if (databaseTestsRequired()) {
      throw new Error(
        `Could not prepare the database integration tests against ${databaseName(url)}: ${String(error)}`,
        { cause: error },
      );
    }
    process.stdout.write(
      `[database-tests] Skipping: could not prepare ${databaseName(url)} (${String(error)}).\n`,
    );
    return undefined;
  }

  return {
    prisma: connection.prisma,
    disconnect: (): Promise<void> => connection.disconnect(),
  };
}

/**
 * Removes all tournament-domain rows, children before parents, so each test
 * starts from a known empty state. `system_metadata` is left untouched.
 */
export async function resetTournamentData(prisma: PrismaClient): Promise<void> {
  await prisma.matchParticipant.deleteMany();
  await prisma.match.deleteMany();
  await prisma.tournamentStage.deleteMany();
  await prisma.tournamentEntry.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.team.deleteMany();
  await prisma.player.deleteMany();
  await prisma.tournamentCategory.deleteMany();
  await prisma.tournament.deleteMany();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

// --- Fixture builders -------------------------------------------------------
// Each builder fills the required fields and accepts overrides so a test can
// express only the variation under scrutiny.

interface TournamentInput {
  readonly name?: string;
  readonly startDate?: Date;
  readonly endDate?: Date;
  readonly timezone?: string;
  readonly status?: 'DRAFT' | 'REGISTRATION_OPEN' | 'COMPLETED' | 'CANCELLED';
}

export function createTournament(prisma: PrismaClient, input: TournamentInput = {}) {
  return prisma.tournament.create({
    data: {
      name: input.name ?? 'Test Tournament',
      startDate: input.startDate ?? new Date('2026-10-01T00:00:00.000Z'),
      endDate: input.endDate ?? new Date('2026-10-03T00:00:00.000Z'),
      timezone: input.timezone ?? 'Asia/Kolkata',
      status: input.status ?? 'DRAFT',
    },
  });
}

interface CategoryInput {
  readonly tournamentId: string;
  readonly name?: string;
  readonly code?: string;
  readonly format?: 'SINGLES' | 'DOUBLES';
  readonly gender?: 'MALE' | 'FEMALE' | 'MIXED' | 'OPEN';
}

export function createCategory(prisma: PrismaClient, input: CategoryInput) {
  return prisma.tournamentCategory.create({
    data: {
      tournamentId: input.tournamentId,
      name: input.name ?? "Men's Singles",
      code: input.code ?? 'MS',
      format: input.format ?? 'SINGLES',
      gender: input.gender ?? 'MALE',
    },
  });
}

interface PlayerInput {
  readonly name?: string;
  readonly email?: string | null;
  readonly phone?: string | null;
}

export function createPlayer(prisma: PrismaClient, input: PlayerInput = {}) {
  return prisma.player.create({
    data: {
      name: input.name ?? 'Player A',
      email: input.email ?? null,
      phone: input.phone ?? null,
    },
  });
}

export function createTeam(prisma: PrismaClient, name = 'Team AB') {
  return prisma.team.create({ data: { name } });
}

export function createTeamMember(
  prisma: PrismaClient,
  input: { readonly teamId: string; readonly playerId: string; readonly position?: number },
) {
  return prisma.teamMember.create({
    data: { teamId: input.teamId, playerId: input.playerId, position: input.position ?? 1 },
  });
}

interface EntryInput {
  readonly categoryId: string;
  readonly playerId?: string | null;
  readonly teamId?: string | null;
  readonly seed?: number | null;
}

export function createEntry(prisma: PrismaClient, input: EntryInput) {
  return prisma.tournamentEntry.create({
    data: {
      categoryId: input.categoryId,
      playerId: input.playerId ?? null,
      teamId: input.teamId ?? null,
      seed: input.seed ?? null,
    },
  });
}

interface StageInput {
  readonly categoryId: string;
  readonly name?: string;
  readonly type?: 'GROUP' | 'KNOCKOUT';
  readonly sequence?: number;
}

export function createStage(prisma: PrismaClient, input: StageInput) {
  return prisma.tournamentStage.create({
    data: {
      categoryId: input.categoryId,
      name: input.name ?? 'Group Stage',
      type: input.type ?? 'GROUP',
      sequence: input.sequence ?? 1,
    },
  });
}

interface MatchInput {
  readonly stageId: string;
  readonly sequence?: number;
}

export function createMatch(prisma: PrismaClient, input: MatchInput) {
  return prisma.match.create({
    data: { stageId: input.stageId, sequence: input.sequence ?? 1 },
  });
}

export function createParticipant(
  prisma: PrismaClient,
  input: { readonly matchId: string; readonly entryId: string; readonly slot: number },
) {
  return prisma.matchParticipant.create({
    data: { matchId: input.matchId, entryId: input.entryId, slot: input.slot },
  });
}
