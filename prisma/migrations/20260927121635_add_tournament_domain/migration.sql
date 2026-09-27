-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CategoryFormat" AS ENUM ('SINGLES', 'DOUBLES');

-- CreateEnum
CREATE TYPE "CategoryGender" AS ENUM ('MALE', 'FEMALE', 'MIXED', 'OPEN');

-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('PENDING', 'CONFIRMED', 'WITHDRAWN', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "StageType" AS ENUM ('GROUP', 'KNOCKOUT');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "tournaments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "location" TEXT,
    "timezone" TEXT NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_categories" (
    "id" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "format" "CategoryFormat" NOT NULL,
    "gender" "CategoryGender",
    "status" "CategoryStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tournament_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "position" SMALLINT NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_entries" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "playerId" UUID,
    "teamId" UUID,
    "seed" INTEGER,
    "status" "EntryStatus" NOT NULL DEFAULT 'PENDING',
    "registeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tournament_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_stages" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "StageType" NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "drawSize" SMALLINT,
    "status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tournament_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "roundNumber" SMALLINT,
    "matchNumber" INTEGER,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_participants" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "slot" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "match_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tournaments_status_idx" ON "tournaments"("status");

-- CreateIndex
CREATE INDEX "tournaments_startDate_idx" ON "tournaments"("startDate");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_categories_tournamentId_code_key" ON "tournament_categories"("tournamentId", "code");

-- CreateIndex
CREATE INDEX "players_name_idx" ON "players"("name");

-- CreateIndex
CREATE INDEX "team_members_playerId_idx" ON "team_members"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_teamId_playerId_key" ON "team_members"("teamId", "playerId");

-- CreateIndex
CREATE INDEX "tournament_entries_categoryId_idx" ON "tournament_entries"("categoryId");

-- CreateIndex
CREATE INDEX "tournament_entries_playerId_idx" ON "tournament_entries"("playerId");

-- CreateIndex
CREATE INDEX "tournament_entries_teamId_idx" ON "tournament_entries"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_stages_categoryId_sequence_key" ON "tournament_stages"("categoryId", "sequence");

-- CreateIndex
CREATE INDEX "matches_status_idx" ON "matches"("status");

-- CreateIndex
CREATE UNIQUE INDEX "matches_stageId_sequence_key" ON "matches"("stageId", "sequence");

-- CreateIndex
CREATE INDEX "match_participants_entryId_idx" ON "match_participants"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "match_participants_matchId_slot_key" ON "match_participants"("matchId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "match_participants_matchId_entryId_key" ON "match_participants"("matchId", "entryId");

-- AddForeignKey
ALTER TABLE "tournament_categories" ADD CONSTRAINT "tournament_categories_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "tournament_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_stages" ADD CONSTRAINT "tournament_stages_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "tournament_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "tournament_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "tournament_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints Prisma cannot express (see docs/phase-2-domain-design.md §10)
--
-- Row-local CHECK constraints and partial unique indexes. Cross-table business
-- rules (entry format, team size, player-in-two-teams, mixed-gender, lifecycle)
-- are owned by the future service layer - no triggers are created here.
-- ---------------------------------------------------------------------------

-- CheckConstraints
ALTER TABLE "tournaments"
  ADD CONSTRAINT "tournaments_date_order" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "tournaments_name_present" CHECK (length(btrim("name")) > 0);

ALTER TABLE "tournament_categories"
  ADD CONSTRAINT "tournament_categories_code_format" CHECK ("code" ~ '^[A-Z0-9-]{1,8}$');

ALTER TABLE "tournament_entries"
  ADD CONSTRAINT "entries_exactly_one_competitor"
    CHECK (("playerId" IS NOT NULL)::int + ("teamId" IS NOT NULL)::int = 1),
  ADD CONSTRAINT "entries_seed_positive" CHECK ("seed" IS NULL OR "seed" > 0);

ALTER TABLE "match_participants"
  ADD CONSTRAINT "match_participants_slot_valid" CHECK ("slot" IN (1, 2));

-- PartialUniqueIndexes
-- No two live tournaments share a name; completed/cancelled names are reusable.
CREATE UNIQUE INDEX "tournaments_active_name_key"
  ON "tournaments" (lower("name"))
  WHERE "status" IN ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS');

-- Category display name unique within a tournament.
CREATE UNIQUE INDEX "tournament_categories_name_key"
  ON "tournament_categories" ("tournamentId", lower("name"));

-- Player contact uniqueness only when present; email case-insensitive.
CREATE UNIQUE INDEX "players_email_key"
  ON "players" (lower("email")) WHERE "email" IS NOT NULL;
CREATE UNIQUE INDEX "players_phone_key"
  ON "players" ("phone") WHERE "phone" IS NOT NULL;

-- One singles registration per player per category.
CREATE UNIQUE INDEX "entries_category_player_key"
  ON "tournament_entries" ("categoryId", "playerId") WHERE "playerId" IS NOT NULL;

-- One doubles registration per team per category.
CREATE UNIQUE INDEX "entries_category_team_key"
  ON "tournament_entries" ("categoryId", "teamId") WHERE "teamId" IS NOT NULL;
