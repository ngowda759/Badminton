-- Phase 9 (TASK-4) - group-stage qualification configuration.
--
-- Adds the configured number of qualifiers that advance from each group into a
-- KNOCKOUT stage. The value is nullable: a GROUP stage, or a knockout whose
-- qualifier count has not been configured, carries no value. A row-local CHECK
-- keeps a present value positive (Prisma cannot express it, so it is written by
-- hand here, mirroring the other domain CHECKs).
--
-- This migration is additive and forward-only; no historical migration is
-- modified and no existing row is affected.

ALTER TABLE "tournament_stages" ADD COLUMN "qualifiersPerGroup" SMALLINT;

ALTER TABLE "tournament_stages"
  ADD CONSTRAINT "tournament_stages_qualifiers_positive"
  CHECK ("qualifiersPerGroup" IS NULL OR "qualifiersPerGroup" > 0);
