-- ---------------------------------------------------------------------------
-- Phase 2.1 database hardening.
--
-- Delta migration on top of `20260927114750_add_tournament_domain`. It only
-- alters existing Phase 2 columns - no table is recreated and no CHECK
-- constraint, partial unique index, foreign key or index from the Phase 2
-- migration is repeated here.
--
-- Changes:
--   * Phase 2 record timestamps become timezone-aware (timestamptz(3)).
--   * Phase 2 ordinal columns become smallint where the design calls for it.
--     `tournament_entries.seed` and `matches.matchNumber` stay integer.
--
-- Phase 1 `system_metadata` is intentionally untouched.
--
-- Existing timestamps were stored as `timestamp(3)` without time zone holding
-- UTC wall-clock values, so the conversion pins the source zone to UTC via
-- `AT TIME ZONE 'UTC'` instead of relying on the session TimeZone setting.
-- ---------------------------------------------------------------------------

-- Timestamps -> timestamptz(3)
ALTER TABLE "tournaments"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "tournament_categories"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "players"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "teams"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "team_members"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "tournament_entries"
  ALTER COLUMN "registeredAt" TYPE TIMESTAMPTZ(3) USING "registeredAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "tournament_stages"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "matches"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "match_participants"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- Ordinal columns -> smallint
ALTER TABLE "team_members"
  ALTER COLUMN "position" TYPE SMALLINT USING "position"::smallint;

ALTER TABLE "tournament_stages"
  ALTER COLUMN "sequence" TYPE SMALLINT USING "sequence"::smallint,
  ALTER COLUMN "drawSize" TYPE SMALLINT USING "drawSize"::smallint;

ALTER TABLE "matches"
  ALTER COLUMN "sequence" TYPE SMALLINT USING "sequence"::smallint,
  ALTER COLUMN "roundNumber" TYPE SMALLINT USING "roundNumber"::smallint;

ALTER TABLE "match_participants"
  ALTER COLUMN "slot" TYPE SMALLINT USING "slot"::smallint;
