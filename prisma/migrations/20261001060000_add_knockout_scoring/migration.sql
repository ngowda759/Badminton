-- TASK-7 - knockout scoring and configuration (V1 parity).
--
-- Adds the per-round knockout scoring configuration to a stage and the
-- snapshotted rule to each match. Both are additive and forward-only; no
-- historical migration is modified and no existing row is affected.
--
--   * `tournament_stages.knockoutRules` - nullable JSONB, keyed by round tag
--     (`{ qf: { format, pointsPerGame }, sf: {...}, final: {...} }`). A GROUP
--     stage, or a knockout whose rules have not been configured, carries none;
--     the domain normalizes a missing/malformed value back to the defaults
--     (best of 3, QF 11 / SF 15 / Final 21).
--   * `matches.knockoutFormat` - the snapshotted match format
--     (`best_of_3` | `single_game`), or NULL for a group match / a knockout
--     match created outside a generated bracket.
--   * `matches.knockoutPointsPerGame` - the snapshotted game points target.
--
-- The two match columns are set together (or both NULL), so a partial snapshot
-- cannot exist; the CHECKs below enforce the legal format and target range and
-- keep the pair consistent.

ALTER TABLE "tournament_stages" ADD COLUMN "knockoutRules" JSONB;

ALTER TABLE "matches" ADD COLUMN "knockoutFormat" TEXT;
ALTER TABLE "matches" ADD COLUMN "knockoutPointsPerGame" SMALLINT;

ALTER TABLE "matches"
  ADD CONSTRAINT "matches_knockout_format_valid"
    CHECK ("knockoutFormat" IS NULL OR "knockoutFormat" IN ('best_of_3', 'single_game')),
  ADD CONSTRAINT "matches_knockout_points_in_range"
    CHECK ("knockoutPointsPerGame" IS NULL OR "knockoutPointsPerGame" BETWEEN 1 AND 99),
  ADD CONSTRAINT "matches_knockout_snapshot_consistent"
    CHECK (
      ("knockoutFormat" IS NULL AND "knockoutPointsPerGame" IS NULL)
      OR ("knockoutFormat" IS NOT NULL AND "knockoutPointsPerGame" IS NOT NULL)
    );
