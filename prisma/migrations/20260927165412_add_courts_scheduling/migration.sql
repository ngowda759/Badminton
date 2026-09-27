-- CreateEnum
CREATE TYPE "CourtStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "courtId" UUID,
ADD COLUMN     "scheduledEndAt" TIMESTAMPTZ(3),
ADD COLUMN     "scheduledStartAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "courts" (
    "id" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "number" SMALLINT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CourtStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "courts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "courts_tournamentId_status_idx" ON "courts"("tournamentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "courts_tournamentId_number_key" ON "courts"("tournamentId", "number");

-- CreateIndex
CREATE INDEX "matches_courtId_scheduledStartAt_idx" ON "matches"("courtId", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "matches_scheduledStartAt_idx" ON "matches"("scheduledStartAt");

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "courts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courts" ADD CONSTRAINT "courts_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints Prisma cannot express.
--
-- Row-local invariants (positive court number, non-empty name, schedule fields
-- that are all-set or all-null with a positive duration) and the scheduling
-- overlap protection. The overlap rule is enforced with a PostgreSQL GiST
-- exclusion constraint over the half-open range [scheduledStartAt,
-- scheduledEndAt): two matches on the same court may touch but not overlap.
-- `btree_gist` supplies GiST equality for the UUID court id. This is the
-- database's final concurrency boundary - application pre-checks give friendly
-- errors, but two racing schedules cannot both commit.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "courts"
  ADD CONSTRAINT "courts_number_positive" CHECK ("number" > 0),
  ADD CONSTRAINT "courts_name_present" CHECK (length(btrim("name")) > 0);

ALTER TABLE "matches"
  ADD CONSTRAINT "matches_schedule_fields_consistent"
    CHECK (
      ("courtId" IS NULL AND "scheduledStartAt" IS NULL AND "scheduledEndAt" IS NULL)
      OR ("courtId" IS NOT NULL AND "scheduledStartAt" IS NOT NULL AND "scheduledEndAt" IS NOT NULL)
    ),
  ADD CONSTRAINT "matches_schedule_range_valid"
    CHECK ("scheduledStartAt" IS NULL OR "scheduledStartAt" < "scheduledEndAt"),
  ADD CONSTRAINT "matches_court_schedule_no_overlap"
    EXCLUDE USING gist (
      "courtId" WITH =,
      tstzrange("scheduledStartAt", "scheduledEndAt", '[)') WITH &&
    )
    WHERE ("courtId" IS NOT NULL AND "scheduledStartAt" IS NOT NULL AND "scheduledEndAt" IS NOT NULL);
