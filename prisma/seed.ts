import { loadEnvironmentFiles } from '@badminton/config';
import { connectDatabase, type PrismaClient } from '@badminton/database';

/**
 * Development seed.
 *
 * Deterministic and idempotent: every row is written with `upsert` keyed on a
 * fixed UUID, so running the seed repeatedly converges on the same state and
 * never duplicates rows. The data is small and illustrative - it demonstrates
 * the tournament relationships (tournaments, categories, players, teams,
 * members, entries, stages, matches, participants) without pretending to be
 * production data.
 *
 * No secrets are seeded.
 */

// Fixed UUIDs keep repeated runs idempotent and make relationships easy to
// follow. Version nibble is `4`, variant nibble is `8`, per RFC 4122.
const ID = {
  tournamentSummer: '00000000-0000-4000-8000-000000000001',
  tournamentWinter: '00000000-0000-4000-8000-000000000002',
  categoryMenSingles: '00000000-0000-4000-8000-000000000101',
  categoryMenDoubles: '00000000-0000-4000-8000-000000000102',
  categoryOpenSingles: '00000000-0000-4000-8000-000000000103',
  playerAarav: '00000000-0000-4000-8000-000000000201',
  playerBen: '00000000-0000-4000-8000-000000000202',
  playerChen: '00000000-0000-4000-8000-000000000203',
  playerDiya: '00000000-0000-4000-8000-000000000204',
  playerElena: '00000000-0000-4000-8000-000000000205',
  playerFarah: '00000000-0000-4000-8000-000000000206',
  teamAaravBen: '00000000-0000-4000-8000-000000000301',
  teamChenDiya: '00000000-0000-4000-8000-000000000302',
  memberAarav: '00000000-0000-4000-8000-000000000311',
  memberBen: '00000000-0000-4000-8000-000000000312',
  memberChen: '00000000-0000-4000-8000-000000000313',
  memberDiya: '00000000-0000-4000-8000-000000000314',
  entryMsAarav: '00000000-0000-4000-8000-000000000401',
  entryMsBen: '00000000-0000-4000-8000-000000000402',
  entryMsChen: '00000000-0000-4000-8000-000000000403',
  entryMsDiya: '00000000-0000-4000-8000-000000000404',
  entryMdAaravBen: '00000000-0000-4000-8000-000000000405',
  entryMdChenDiya: '00000000-0000-4000-8000-000000000406',
  entryOsElena: '00000000-0000-4000-8000-000000000407',
  entryOsFarah: '00000000-0000-4000-8000-000000000408',
  stageMsGroup: '00000000-0000-4000-8000-000000000501',
  stageMsKnockout: '00000000-0000-4000-8000-000000000502',
  stageMdKnockout: '00000000-0000-4000-8000-000000000503',
  matchMsGroup1: '00000000-0000-4000-8000-000000000601',
  matchMsGroup2: '00000000-0000-4000-8000-000000000602',
  matchMsSemi: '00000000-0000-4000-8000-000000000603',
  matchMdFinal: '00000000-0000-4000-8000-000000000604',
  partMsGroup1A: '00000000-0000-4000-8000-000000000701',
  partMsGroup1B: '00000000-0000-4000-8000-000000000702',
  partMsGroup2A: '00000000-0000-4000-8000-000000000703',
  partMsGroup2B: '00000000-0000-4000-8000-000000000704',
  partMsSemiA: '00000000-0000-4000-8000-000000000705',
  partMsSemiB: '00000000-0000-4000-8000-000000000706',
  partMdFinalA: '00000000-0000-4000-8000-000000000707',
  partMdFinalB: '00000000-0000-4000-8000-000000000708',
} as const;

interface SeedEntry {
  readonly key: string;
  readonly value: string;
}

const FOUNDATION_METADATA: readonly SeedEntry[] = [
  { key: 'schema.version', value: '2' },
  { key: 'schema.phase', value: '2.1-tournament-database' },
  { key: 'seed.version', value: '2' },
];

async function seedFoundationMetadata(prisma: PrismaClient): Promise<void> {
  for (const entry of FOUNDATION_METADATA) {
    await prisma.systemMetadata.upsert({
      where: { key: entry.key },
      update: { value: entry.value },
      create: { key: entry.key, value: entry.value },
    });
  }
}

async function seedTournamentsAndCategories(prisma: PrismaClient): Promise<void> {
  await prisma.tournament.upsert({
    where: { id: ID.tournamentSummer },
    update: {},
    create: {
      id: ID.tournamentSummer,
      name: 'Summer Open 2026',
      description: 'Illustrative summer tournament used by the development seed.',
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: new Date('2026-08-03T00:00:00.000Z'),
      location: 'Bengaluru',
      timezone: 'Asia/Kolkata',
      status: 'IN_PROGRESS',
    },
  });

  await prisma.tournament.upsert({
    where: { id: ID.tournamentWinter },
    update: {},
    create: {
      id: ID.tournamentWinter,
      name: 'Winter Classic 2026',
      startDate: new Date('2026-12-10T00:00:00.000Z'),
      endDate: new Date('2026-12-12T00:00:00.000Z'),
      location: 'Mumbai',
      timezone: 'Asia/Kolkata',
      status: 'DRAFT',
    },
  });

  const categories = [
    {
      id: ID.categoryMenSingles,
      tournamentId: ID.tournamentSummer,
      name: "Men's Singles",
      code: 'MS',
      format: 'SINGLES',
      gender: 'MALE',
      status: 'COMPLETED',
    },
    {
      id: ID.categoryMenDoubles,
      tournamentId: ID.tournamentSummer,
      name: "Men's Doubles",
      code: 'MD',
      format: 'DOUBLES',
      gender: 'MALE',
      status: 'OPEN',
    },
    {
      id: ID.categoryOpenSingles,
      tournamentId: ID.tournamentWinter,
      name: 'Open Singles',
      code: 'OS',
      format: 'SINGLES',
      gender: 'OPEN',
      status: 'DRAFT',
    },
  ] as const;

  for (const category of categories) {
    await prisma.tournamentCategory.upsert({
      where: { id: category.id },
      update: {},
      create: { ...category },
    });
  }
}

async function seedPlayers(prisma: PrismaClient): Promise<void> {
  const players = [
    {
      id: ID.playerAarav,
      name: 'Aarav Sharma',
      email: 'aarav@example.com',
      phone: '+91-9000000001',
    },
    { id: ID.playerBen, name: 'Ben Carter', email: 'ben@example.com', phone: '+91-9000000002' },
    { id: ID.playerChen, name: 'Chen Wei', email: 'chen@example.com', phone: '+91-9000000003' },
    { id: ID.playerDiya, name: 'Diya Patel', email: 'diya@example.com', phone: '+91-9000000004' },
    { id: ID.playerElena, name: 'Elena Rossi', email: 'elena@example.com' },
    { id: ID.playerFarah, name: 'Farah Khan' },
  ] as const;

  for (const player of players) {
    await prisma.player.upsert({
      where: { id: player.id },
      update: {},
      create: { ...player },
    });
  }
}

async function seedTeams(prisma: PrismaClient): Promise<void> {
  await prisma.team.upsert({
    where: { id: ID.teamAaravBen },
    update: {},
    create: { id: ID.teamAaravBen, name: 'Aarav / Ben' },
  });
  await prisma.team.upsert({
    where: { id: ID.teamChenDiya },
    update: {},
    create: { id: ID.teamChenDiya, name: 'Chen / Diya' },
  });

  const members = [
    { id: ID.memberAarav, teamId: ID.teamAaravBen, playerId: ID.playerAarav, position: 1 },
    { id: ID.memberBen, teamId: ID.teamAaravBen, playerId: ID.playerBen, position: 2 },
    { id: ID.memberChen, teamId: ID.teamChenDiya, playerId: ID.playerChen, position: 1 },
    { id: ID.memberDiya, teamId: ID.teamChenDiya, playerId: ID.playerDiya, position: 2 },
  ] as const;

  for (const member of members) {
    await prisma.teamMember.upsert({
      where: { id: member.id },
      update: {},
      create: { ...member },
    });
  }
}

async function seedEntries(prisma: PrismaClient): Promise<void> {
  const entries = [
    {
      id: ID.entryMsAarav,
      categoryId: ID.categoryMenSingles,
      playerId: ID.playerAarav,
      seed: 1,
      status: 'CONFIRMED',
    },
    {
      id: ID.entryMsBen,
      categoryId: ID.categoryMenSingles,
      playerId: ID.playerBen,
      seed: 2,
      status: 'CONFIRMED',
    },
    {
      id: ID.entryMsChen,
      categoryId: ID.categoryMenSingles,
      playerId: ID.playerChen,
      seed: 3,
      status: 'CONFIRMED',
    },
    {
      id: ID.entryMsDiya,
      categoryId: ID.categoryMenSingles,
      playerId: ID.playerDiya,
      seed: 4,
      status: 'CONFIRMED',
    },
    {
      id: ID.entryMdAaravBen,
      categoryId: ID.categoryMenDoubles,
      teamId: ID.teamAaravBen,
      seed: 1,
      status: 'CONFIRMED',
    },
    {
      id: ID.entryMdChenDiya,
      categoryId: ID.categoryMenDoubles,
      teamId: ID.teamChenDiya,
      seed: 2,
      status: 'CONFIRMED',
    },
    {
      id: ID.entryOsElena,
      categoryId: ID.categoryOpenSingles,
      playerId: ID.playerElena,
      status: 'PENDING',
    },
    {
      id: ID.entryOsFarah,
      categoryId: ID.categoryOpenSingles,
      playerId: ID.playerFarah,
      status: 'PENDING',
    },
  ] as const;

  for (const entry of entries) {
    await prisma.tournamentEntry.upsert({
      where: { id: entry.id },
      update: {},
      create: { ...entry },
    });
  }
}

async function seedStagesMatchesAndParticipants(prisma: PrismaClient): Promise<void> {
  const stages = [
    {
      id: ID.stageMsGroup,
      categoryId: ID.categoryMenSingles,
      name: 'Group Stage',
      type: 'GROUP',
      sequence: 1,
      drawSize: 4,
      status: 'COMPLETED',
    },
    {
      id: ID.stageMsKnockout,
      categoryId: ID.categoryMenSingles,
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 2,
      drawSize: 2,
      status: 'ACTIVE',
    },
    {
      id: ID.stageMdKnockout,
      categoryId: ID.categoryMenDoubles,
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
      drawSize: 2,
      status: 'PENDING',
    },
  ] as const;

  for (const stage of stages) {
    await prisma.tournamentStage.upsert({
      where: { id: stage.id },
      update: {},
      create: { ...stage },
    });
  }

  const matches = [
    {
      id: ID.matchMsGroup1,
      stageId: ID.stageMsGroup,
      sequence: 1,
      matchNumber: 1,
      status: 'COMPLETED',
    },
    {
      id: ID.matchMsGroup2,
      stageId: ID.stageMsGroup,
      sequence: 2,
      matchNumber: 2,
      status: 'COMPLETED',
    },
    {
      id: ID.matchMsSemi,
      stageId: ID.stageMsKnockout,
      sequence: 1,
      roundNumber: 1,
      matchNumber: 3,
      status: 'IN_PROGRESS',
    },
    {
      id: ID.matchMdFinal,
      stageId: ID.stageMdKnockout,
      sequence: 1,
      roundNumber: 1,
      matchNumber: 1,
      status: 'SCHEDULED',
    },
  ] as const;

  for (const match of matches) {
    await prisma.match.upsert({
      where: { id: match.id },
      update: {},
      create: { ...match },
    });
  }

  const participants = [
    { id: ID.partMsGroup1A, matchId: ID.matchMsGroup1, entryId: ID.entryMsAarav, slot: 1 },
    { id: ID.partMsGroup1B, matchId: ID.matchMsGroup1, entryId: ID.entryMsBen, slot: 2 },
    { id: ID.partMsGroup2A, matchId: ID.matchMsGroup2, entryId: ID.entryMsChen, slot: 1 },
    { id: ID.partMsGroup2B, matchId: ID.matchMsGroup2, entryId: ID.entryMsDiya, slot: 2 },
    { id: ID.partMsSemiA, matchId: ID.matchMsSemi, entryId: ID.entryMsAarav, slot: 1 },
    { id: ID.partMsSemiB, matchId: ID.matchMsSemi, entryId: ID.entryMsChen, slot: 2 },
    { id: ID.partMdFinalA, matchId: ID.matchMdFinal, entryId: ID.entryMdAaravBen, slot: 1 },
    { id: ID.partMdFinalB, matchId: ID.matchMdFinal, entryId: ID.entryMdChenDiya, slot: 2 },
  ] as const;

  for (const participant of participants) {
    await prisma.matchParticipant.upsert({
      where: { id: participant.id },
      update: {},
      create: { ...participant },
    });
  }
}

async function seed(): Promise<void> {
  loadEnvironmentFiles();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run the seed. Copy .env.example to .env first.');
  }

  const database = connectDatabase(connectionString);

  try {
    await seedFoundationMetadata(database.prisma);
    await seedTournamentsAndCategories(database.prisma);
    await seedPlayers(database.prisma);
    await seedTeams(database.prisma);
    await seedEntries(database.prisma);
    await seedStagesMatchesAndParticipants(database.prisma);

    process.stdout.write(
      'Seed complete: metadata, 2 tournaments, 3 categories, 6 players, 2 teams, ' +
        '4 team members, 8 entries, 3 stages, 4 matches and 8 participants upserted.\n',
    );
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
