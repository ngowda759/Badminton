import { loadEnvironmentFiles } from '@badminton/config';
import { connectDatabase } from '@badminton/database';

/**
 * Foundation seed.
 *
 * Idempotent and deterministic: every row is written with `upsert` on its
 * unique `key`, so running the seed repeatedly converges on the same state and
 * never duplicates rows or changes timestamps unnecessarily.
 *
 * No tournament data is inserted - only infrastructure metadata that proves the
 * schema, migrations and connection all work end to end.
 */

interface SeedEntry {
  readonly key: string;
  readonly value: string;
}

const FOUNDATION_METADATA: readonly SeedEntry[] = [
  { key: 'schema.version', value: '1' },
  { key: 'schema.phase', value: '1-foundation' },
  { key: 'seed.version', value: '1' },
];

async function seed(): Promise<void> {
  loadEnvironmentFiles();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run the seed. Copy .env.example to .env first.');
  }

  const database = connectDatabase(connectionString);

  try {
    for (const entry of FOUNDATION_METADATA) {
      await database.prisma.systemMetadata.upsert({
        where: { key: entry.key },
        update: { value: entry.value },
        create: { key: entry.key, value: entry.value },
      });
    }

    process.stdout.write(`Seed complete: ${FOUNDATION_METADATA.length} metadata rows upserted.\n`);
  } finally {
    await database.disconnect();
  }
}

seed().catch((error: unknown) => {
  process.stderr.write('Seed failed.\n');
  if (error instanceof Error) {
    process.stderr.write(`${error.message}\n`);
  }
  process.exit(1);
});
