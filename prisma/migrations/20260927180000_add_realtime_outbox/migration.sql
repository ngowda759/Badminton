-- ---------------------------------------------------------------------------
-- Phase 8.1 - realtime transactional outbox.
--
-- Forward-only migration. It only creates the new `realtime_events` table; no
-- historical migration or Phase 1-7 table is modified.
--
-- The row is the durable record of "something changed" written in the same
-- transaction as the business change, so a committed business change always has
-- its event and a rolled-back one never does. `eventType`/`aggregateType` are
-- stored as text because the event catalogue is validated in
-- `@badminton/domain`, not by a database enum, so the catalogue can grow
-- without a further migration. `publishedAt` is the only mutable column: the
-- dispatcher stamps it once an event has been forwarded to SSE subscribers.
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "realtime_events" (
    "id" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "realtime_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "realtime_events_tournamentId_createdAt_idx" ON "realtime_events"("tournamentId", "createdAt");

-- CreateIndex
CREATE INDEX "realtime_events_publishedAt_idx" ON "realtime_events"("publishedAt");

-- ---------------------------------------------------------------------------
-- Hand-written constraints Prisma cannot express.
--
-- The catalogue columns must be present and a published timestamp can never
-- precede creation. These are row-local invariants only; catalogue membership
-- itself stays in the domain layer.
-- ---------------------------------------------------------------------------

ALTER TABLE "realtime_events"
  ADD CONSTRAINT "realtime_events_event_type_present" CHECK (length(btrim("eventType")) > 0),
  ADD CONSTRAINT "realtime_events_aggregate_type_present" CHECK (length(btrim("aggregateType")) > 0),
  ADD CONSTRAINT "realtime_events_published_after_created"
    CHECK ("publishedAt" IS NULL OR "publishedAt" >= "createdAt");

-- ---------------------------------------------------------------------------
-- Cross-process wake-up.
--
-- After a committed insert, notify listeners on the `realtime_events` channel
-- with the tournament id so a dispatcher in another API process drains without
-- waiting for its poll tick. PostgreSQL fires `NOTIFY` only on commit, so a
-- rolled-back transaction never wakes the dispatcher, and a lost notification
-- is recovered by the poll - the durable row, not the signal, is authoritative.
-- The function only reads NEW and calls pg_notify, so it needs no search path.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "notify_realtime_event"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('realtime_events', NEW."tournamentId"::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER "realtime_events_notify"
  AFTER INSERT ON "realtime_events"
  FOR EACH ROW
  EXECUTE FUNCTION "notify_realtime_event"();
