import { execFileSync } from 'node:child_process';

import { loadEnvironmentFiles } from '@badminton/config';
import { connectDatabase, type DatabaseConnection, type PrismaClient } from '@badminton/database';

/**
 * Harness for the Phase 2 database integration tests.
 *
 * The suite runs against **real PostgreSQL** (no Prisma mocks). To avoid
 * touching a developer's normal `public` schema, every test operates inside a
 * dedicated `badminton_test` schema that is created and migrated by
 * `prisma migrate deploy` before the run.
 *
 * When no database is reachable the harness returns `undefined` and the calling
 * suite is skipped, so `npm test` still passes on a machine without PostgreSQL
 * (matching Phase 1's "unit tests need no database" contract). CI and the
 * documented verification commands provide a database, so the tests execute
 * there.
 *
 * Migrations are applied lazily, the first time a suite tries to open the test
 * database. Keeping this out of a shared Vitest global setup means the unit and
 * Phase 1 integration suites never touch PostgreSQL at all.
 */

export const TEST_SCHEMA = 'badminton_test';

/** Derives the test connection string by pointing `DATABASE_URL` at the test schema. */
export function resolveTestDatabaseUrl(): string | undefined {
  // Vitest does not load `.env` for us; the repository loader keeps this
  // consistent with `npm run db:*` and the API.
  loadEnvironmentFiles();

  const configured = process.env.DATABASE_URL;
  if (!configured) {
    return undefined;
  }

  try {
    const url = new URL(configured);
    url.searchParams.set('schema', TEST_SCHEMA);
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * Applies migrations to the dedicated test schema, at most once per process.
 *
 * Failures are reported and swallowed so a missing database skips the suite
 * instead of failing it.
 */
let migrated = false;

export function ensureTestSchema(): void {
  if (migrated) {
    return;
  }
  migrated = true;

  const url = resolveTestDatabaseUrl();
  if (!url) {
    process.stdout.write('[database-tests] DATABASE_URL is not set; database tests will skip.\n');
    return;
  }

  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      timeout: 120_000,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stdout.write(`[database-tests] Could not prepare ${TEST_SCHEMA}: ${message}\n`);
  }
}

/** An open connection to the migrated test schema. */
export interface TestDatabase {
  readonly prisma: PrismaClient;
  disconnect(): Promise<void>;
}

/**
 * Opens a connection to the test schema and verifies the tournament tables
 * exist. Returns `undefined` (so the suite skips) when PostgreSQL is absent or
 * the schema is not migrated.
 */
export async function openTestDatabase(): Promise<TestDatabase | undefined> {
  const url = resolveTestDatabaseUrl();
  if (!url) {
    return undefined;
  }

  ensureTestSchema();

  let connection: DatabaseConnection | undefined;
  try {
    connection = connectDatabase(url);
    await connection.prisma.$queryRaw`SELECT 1 FROM "tournaments" LIMIT 0`;
  } catch {
    await connection?.disconnect();
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
