-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "winnerEntryId" UUID;

-- CreateTable
CREATE TABLE "match_games" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "gameNumber" SMALLINT NOT NULL,
    "participant1Points" SMALLINT NOT NULL,
    "participant2Points" SMALLINT NOT NULL,
    "winnerSlot" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "match_games_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "match_games_matchId_gameNumber_key" ON "match_games"("matchId", "gameNumber");

-- CreateIndex
CREATE INDEX "matches_winnerEntryId_idx" ON "matches"("winnerEntryId");

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_winnerEntryId_fkey" FOREIGN KEY ("winnerEntryId") REFERENCES "tournament_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_games" ADD CONSTRAINT "match_games_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints Prisma cannot express.
--
-- These are true row-local invariants only. The full badminton scoring rules
-- (win at 21 with a two-point lead, 30-point ceiling semantics, best-of-three
-- completeness) live in `@badminton/domain` and are enforced by the
-- application service - the database stays the final structural boundary, not
-- the rule engine.
-- ---------------------------------------------------------------------------

ALTER TABLE "match_games"
  ADD CONSTRAINT "match_games_number_valid" CHECK ("gameNumber" IN (1, 2, 3)),
  ADD CONSTRAINT "match_games_points_in_range"
    CHECK (
      "participant1Points" BETWEEN 0 AND 30
      AND "participant2Points" BETWEEN 0 AND 30
    ),
  ADD CONSTRAINT "match_games_winner_slot_valid" CHECK ("winnerSlot" IN (1, 2)),
  ADD CONSTRAINT "match_games_winner_matches_points"
    CHECK (
      ("winnerSlot" = 1 AND "participant1Points" > "participant2Points")
      OR ("winnerSlot" = 2 AND "participant2Points" > "participant1Points")
    );
