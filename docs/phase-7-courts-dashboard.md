# Phase 7 — Court management, match scheduling and tournament dashboard

Status: implemented on `main`.

This document describes the operational layer added in Phase 7: per-tournament
court management, operator-controlled match scheduling, schedule conflict
validation, the aggregated tournament dashboard read model and the court board
UI. It builds directly on the domain, API and UI from Phases 2–6; the
authoritative design remains
[`phase-2-domain-design.md`](./phase-2-domain-design.md), the layering is
described in [`phase-2-2-architecture.md`](./phase-2-2-architecture.md), the HTTP
surface in [`phase-3-rest-api.md`](./phase-3-rest-api.md), the setup UI in
[`phase-4-tournament-ui.md`](./phase-4-tournament-ui.md), the scoring workflow in
[`phase-5-group-scoring.md`](./phase-5-group-scoring.md) and the knockout engine
in [`phase-6-knockout.md`](./phase-6-knockout.md).

Phase 7 **adds one forward-only migration** (`add_courts_scheduling`) and changes
no historical migration. The existing competition engine stays authoritative for
match lifecycle, scoring, standings and knockout progression; Phase 7 decides
only _where_ and _when_ a match is played.

## 1. Purpose

An operator can turn a set of matches into a runnable schedule:

```
create courts for the tournament
        ↓
create (or generate) matches as before
        ↓
schedule a match: pick an active court + a [start, end) window
        ↓
overlapping schedules on the same court are rejected
        ↓
court board shows current / next match per court
        ↓
dashboard aggregates matches, courts and progress
        ↓
existing lifecycle + scoring + standings + knockout progression unchanged
```

The operator decides where and when a match is played. The system guarantees the
decision is valid and consistent; it never decides the schedule automatically.

## 2. Architecture

The Phase 2–6 layering is unchanged and enforced:

```
apps/web  (React)
    │  typed API client only
    ▼
REST API  (/api/v1, thin routes)
    │  Zod request-shape validation + response envelope
    ▼
Application services  (CourtService, MatchSchedulingService,
                       TournamentDashboardService)
    │  orchestration + rule enforcement
    ▼
Domain  (court.ts, scheduling.ts — pure)
    │
    ▼
Repository ports  (RepositoryClient, CourtRepository, MatchRepository)
    │
    ▼
Infrastructure  (Prisma repositories, error translation)
    │
    ▼
PostgreSQL  (unique index + GiST exclusion constraint = final boundary)
```

`web → API` only, services depend on ports, the domain depends on nothing, and
Prisma never leaks outside `@badminton/infrastructure` and `@badminton/database`.
Route handlers contain no business rules and do not import Prisma.

## 3. Database changes

One new forward-only migration:
`prisma/migrations/20260927165412_add_courts_scheduling`.

### `courts` table

| Column         | Type             | Nullable | Notes                                 |
| -------------- | ---------------- | -------- | ------------------------------------- |
| `id`           | `uuid`           | no       | Primary key                           |
| `tournamentId` | `uuid`           | no       | FK → `tournaments.id` (RESTRICT)      |
| `number`       | `smallint`       | no       | Operator-facing, ≥ 1                  |
| `name`         | `text`           | no       | Non-empty (trimmed)                   |
| `status`       | `CourtStatus`    | no       | `ACTIVE` / `INACTIVE`, default ACTIVE |
| `createdAt`    | `timestamptz(3)` | no       | UTC                                   |
| `updatedAt`    | `timestamptz(3)` | no       | UTC                                   |

### `matches` additions

| Column             | Type             | Nullable | Notes                       |
| ------------------ | ---------------- | -------- | --------------------------- |
| `courtId`          | `uuid`           | yes      | FK → `courts.id` (RESTRICT) |
| `scheduledStartAt` | `timestamptz(3)` | yes      | Start of `[start, end)`     |
| `scheduledEndAt`   | `timestamptz(3)` | yes      | End of `[start, end)`       |

A match may exist without scheduling information (`courtId` and both timestamps
`NULL`), because manually created matches do not have a court or time yet.

### Indexes and constraints

- `courts_tournamentId_number_key` — `UNIQUE (tournamentId, number)`. Court
  numbers are unique **within a tournament only**; two tournaments may both have
  a "Court 1".
- `courts_tournamentId_status_idx` — `INDEX (tournamentId, status)`.
- `matches_courtId_scheduledStartAt_idx` — `INDEX (courtId, scheduledStartAt)`.
- `matches_scheduledStartAt_idx` — `INDEX (scheduledStartAt)`.

Hand-written constraints (Prisma cannot express these):

- `courts_number_positive` — `CHECK (number > 0)`.
- `courts_name_present` — `CHECK (length(btrim(name)) > 0)`.
- `matches_schedule_fields_consistent` — the three schedule fields are all `NULL`
  or all set. A partially scheduled match is impossible at the database level.
- `matches_schedule_range_valid` — `scheduledStartAt < scheduledEndAt`; a
  zero-length or reversed window is impossible.
- `matches_court_schedule_no_overlap` — a GiST **exclusion constraint** over
  `courtId WITH =` and `tstzrange(scheduledStartAt, scheduledEndAt, '[)') WITH &&`,
  filtered to rows where the schedule is set:

  ```sql
  ALTER TABLE "matches"
    ADD CONSTRAINT "matches_court_schedule_no_overlap"
      EXCLUDE USING gist (
        "courtId" WITH =,
        tstzrange("scheduledStartAt", "scheduledEndAt", '[)') WITH &&
      )
      WHERE ("courtId" IS NOT NULL
             AND "scheduledStartAt" IS NOT NULL
             AND "scheduledEndAt" IS NOT NULL);
  ```

  The `btree_gist` extension supplies GiST equality for the UUID court id.
  Unscheduled matches are excluded because their court is `NULL`.

Historical migrations (Phase 1, Phase 2, Phase 2.1 hardening, Phase 5 scoring)
are untouched.

## 4. Scheduling rules

All of the following live in the application/domain layer. Pre-checks exist for
friendly error messages; the database constraints above are the final authority.

- **Start must precede end.** `scheduledStartAt < scheduledEndAt`. A
  zero-duration match is invalid.
- **Court must belong to the match's tournament.** The owning tournament is
  resolved through `match → stage → category → tournament`; the selected court
  must have that same `tournamentId`.
- **Inactive courts cannot receive new schedules.** Deactivating a court does not
  delete existing historical assignments.
- **Completed matches cannot be rescheduled.** A completed match is immutable
  from the scheduling perspective.
- **Cancelled matches cannot be scheduled.**
- **In-progress matches cannot be rescheduled.** A match must not move while it
  is being played.
- **Only `SCHEDULED` matches can be cleared** (unscheduled).

### Conflict rule

Two matches conflict when:

```
same court
AND existing.start < requested.end
AND requested.start < existing.end
```

The window is half-open `[start, end)`, so:

| Existing    | Requested   | Result                 |
| ----------- | ----------- | ---------------------- |
| 10:00–10:30 | 10:30–11:00 | no conflict (adjacent) |
| 10:00–10:30 | 10:29–11:00 | conflict               |
| 10:00–10:30 | 10:15–10:20 | conflict (contained)   |
| 10:00–10:30 | 09:00–10:00 | no conflict (adjacent) |

## 5. Concurrency strategy

Application pre-checks cannot stop two operators from racing:

```
Operator A → Court 1 → 10:00–10:30
Operator B → Court 1 → 10:15–10:45
```

Both can pass a normal pre-check, so the guarantee is pushed to PostgreSQL: the
`matches_court_schedule_no_overlap` GiST exclusion constraint makes the second
commit fail. The infrastructure layer translates the PostgreSQL `23P01`
exclusion-constraint violation into a domain `ConflictError` (never leaking SQL,
constraint names or stack traces). The duplicate-court race is handled the same
way via the `courts_tournamentId_number_key` unique index.

## 6. Domain layer

`packages/domain/src/court.ts`:

- `COURT_STATUSES` — `['ACTIVE', 'INACTIVE']`.
- `Court` — id, tournamentId, number, name, status, timestamps.
- `COURT_TRANSITIONS` — the two-state lifecycle table (any state → either state).

`packages/domain/src/scheduling.ts` (pure, dependency-free):

- `ScheduleWindow` — `{ startAt, endAt }`.
- `isValidScheduleRange(startAt, endAt)` — `start < end`.
- `doScheduleWindowsOverlap(aStart, aEnd, bStart, bEnd)` — half-open overlap.

These helpers know nothing about Prisma or PostgreSQL; they mirror the same rule
the exclusion constraint enforces.

## 7. Application layer

### CourtService

Owns court business rules:

- `create(tournamentId, command)` — validates a positive whole number and a
  non-empty name, verifies the tournament exists, pre-checks the duplicate number
  (the unique index is the final authority) and creates the court `ACTIVE`.
- `update(id, command)` — updates number and/or name with the same validation.
- `transitionStatus(id, command)` — `ACTIVE ↔ INACTIVE`, idempotent for a no-op.
- `getById(id)` / `listByTournament(tournamentId)` — reads.

### MatchSchedulingService

Owns scheduling rules and nothing else. It deliberately does **not** calculate
standings, drive knockout progression, record scores or choose winners.

- `schedule(matchId, command)` — loads the match, asserts it is `SCHEDULED`,
  validates the interval, loads the court, resolves the owning tournament via
  `match → stage → category`, rejects a cross-tournament court, rejects an
  inactive court, pre-checks for an overlapping schedule and persists
  `{ courtId, scheduledStartAt, scheduledEndAt }`.
- `unschedule(matchId)` — clears the three fields, only for a `SCHEDULED` match.

### TournamentDashboardService

Read-only aggregation. It persists nothing. `getDashboard(tournamentId)`
performs a **bounded, fixed set of batched queries** — no N+1:

```
tournaments.findById(tournamentId)
categories.listByTournament(tournamentId)
entries.listByTournament(tournamentId)
stages.listByTournament(tournamentId)
matches.listByTournament(tournamentId)
courts.listByTournament(tournamentId)
players.listByIds([...playerIds])   ┐ competitor names, two batched reads
teams.listByIds([...teamIds])       ┘
```

Competitor display names are resolved entry → player/team with one query per
entity type, never per match.

## 8. Dashboard read model

`GET /api/v1/tournaments/:tournamentId/dashboard` returns one aggregated object:

```jsonc
{
  "data": {
    "tournament": {/* tournament header */},
    "summary": {
      "totalEntries": 32,
      "totalMatches": 48,
      "completedMatches": 21,
      "inProgressMatches": 2,
      "scheduledMatches": 15,
      "unscheduledMatches": 10,
    },
    "courts": [/* id, number, name, status, busy */],
    "liveMatches": [/* IN_PROGRESS */],
    "upcomingMatches": [/* SCHEDULED with a start >= now */],
    "recentResults": [/* COMPLETED, bounded */],
    "unscheduledMatches": [/* SCHEDULED with courtId = null */],
    "categories": [/* category + stage progress */],
  },
}
```

Data rules:

- **Live matches** — `status = IN_PROGRESS`.
- **Upcoming matches** — `status = SCHEDULED`, `scheduledStartAt` not null and
  `>= now`, ordered by `scheduledStartAt ASC` then `court.number ASC` for
  deterministic output.
- **Recent results** — `status = COMPLETED`, ordered by `updatedAt DESC`, with a
  bounded result count so the API never returns unlimited history.
- **Unscheduled matches** — `status = SCHEDULED` with `courtId = null`; these are
  the matches needing operator attention.
- **Court busy** — derived: a court is busy when it has an `IN_PROGRESS` match.
  There is no `BUSY` database status.

## 9. REST API

Courts:

| Method | Path                                       |
| ------ | ------------------------------------------ |
| POST   | `/api/v1/tournaments/:tournamentId/courts` |
| GET    | `/api/v1/tournaments/:tournamentId/courts` |
| GET    | `/api/v1/courts/:id`                       |
| PATCH  | `/api/v1/courts/:id`                       |
| POST   | `/api/v1/courts/:id/transition`            |

Scheduling:

| Method | Path                           |
| ------ | ------------------------------ |
| POST   | `/api/v1/matches/:id/schedule` |
| DELETE | `/api/v1/matches/:id/schedule` |

Example schedule request:

```json
{
  "courtId": "uuid",
  "scheduledStartAt": "2026-10-05T10:00:00.000Z",
  "scheduledEndAt": "2026-10-05T10:30:00.000Z"
}
```

Dashboard:

| Method | Path                                          |
| ------ | --------------------------------------------- |
| GET    | `/api/v1/tournaments/:tournamentId/dashboard` |

All endpoints use the established `{ data }` / `{ error }` envelopes.

### HTTP error mapping

| Situation                          | Status |
| ---------------------------------- | ------ |
| Invalid request shape              | 400    |
| Tournament / court / match missing | 404    |
| Duplicate court number             | 409    |
| Schedule overlap                   | 409    |
| Invalid lifecycle operation        | 409    |
| Cross-tournament court assignment  | 422    |
| Invalid scheduling interval        | 422    |
| Inactive court assignment          | 422    |
| Unexpected persistence failure     | 500    |

PostgreSQL constraint names and SQL errors are never exposed.

## 10. Transaction boundaries

- **Court create / update / transition** — single write, no interactive
  transaction.
- **Schedule** — a read-heavy validation followed by a single write; the atomic
  guarantee comes from the database exclusion constraint, so no interactive
  transaction is opened. The operation either saves all three schedule fields
  (enforced by `matches_schedule_fields_consistent`) or changes nothing.
- **Unschedule** — single atomic update.
- **Dashboard / court list** — read-only, no transaction.

`tests/unit/application/transaction-boundaries.test.ts` covers these boundaries.

## 11. Frontend

New routes under the tournament layout (`apps/web/src/routes.tsx`):

| Route                                      | Page                 |
| ------------------------------------------ | -------------------- |
| `/tournaments/:tournamentId/dashboard`     | Tournament dashboard |
| `/tournaments/:tournamentId/courts`        | Court board          |
| `/tournaments/:tournamentId/courts/manage` | Court management     |

- **Court management** — create a court, edit number/name, activate/deactivate.
- **Court board** — one card per active court showing LIVE / NEXT / IDLE, the
  current or next match, participants, status and scheduled time. Read-only with
  respect to scoring; scoring stays in the existing match workflow.
- **Tournament dashboard** — header (name, status, dates, location), summary
  cards (entries, total, completed, live, scheduled, unscheduled), live courts,
  upcoming matches, recent results and category/stage progress.
- **Match schedule panel** — on the match detail page, assigns a court and
  start/end window to a `SCHEDULED` match or clears it; hidden/disabled for other
  statuses.
- **Manual refresh** — every operational page has a Refresh button and refreshes
  after mutations. There is **no polling**; realtime is deferred to Phase 8.

The `TournamentLayout` nav links to Dashboard, Court board and Courts.

## 12. Integration with existing behaviour

- **Scoring** — unchanged. Sequence remains `SCHEDULED → IN_PROGRESS → record
result → COMPLETED`; scheduling adds information before that and never records
  scores.
- **GROUP matches** — scheduled through the same service; standings stay derived
  and are never altered by scheduling.
- **KNOCKOUT matches** — Phase 6-generated matches can be scheduled. When a
  winner progresses into the next round, the destination match keeps its
  scheduling information only if it was explicitly scheduled. Phase 7 never
  auto-schedules a newly populated knockout match.
- **Stage completion / draw-size immutability** — untouched.

## 13. Non-goals

Explicitly out of scope for Phase 7: WebSockets, Server-Sent Events, Supabase
Realtime, browser polling, push notifications, automatic/AI scheduling
optimisation, ranking/Elo, seeding algorithms, authentication, authorization,
payments, result correction, audit history, spectator live pages, mobile apps,
CSV import/export, analytics, Redis, background workers, queues and external
scheduling services. Realtime belongs to Phase 8; deployment/Supabase to Phase 9.

No new runtime dependency was introduced.

## 14. Testing

- **Domain unit** (`tests/unit/domain/scheduling.test.ts`) — valid range, equal
  start/end rejected, end-before-start rejected, overlapping, adjacent, contained
  and non-overlapping intervals.
- **Application unit** (`tests/unit/application/court-scheduling.service.test.ts`,
  `dashboard.service.test.ts`) — court creation, duplicate court, inactive court,
  cross-tournament court, scheduling a `SCHEDULED` match, rejecting
  `COMPLETED` / `CANCELLED` / `IN_PROGRESS` rescheduling, unscheduling,
  invalid range, scheduling conflict, GROUP and KNOCKOUT scheduling, dashboard
  aggregation.
- **API integration** (`tests/integration/api/court-scheduling.routes.test.ts`) —
  court CRUD, court lifecycle, schedule/unschedule endpoints, dashboard endpoint,
  validation, 404/409/422 and sanitized 500 behaviour.
- **Database integration** (`tests/integration/database/court-scheduling-database.test.ts`) —
  unique court number, the schedule-overlap exclusion constraint, a concurrent
  schedule race, cross-tournament court FK and schedule-field consistency.
- **E2E** (`e2e/phase7-courts-dashboard.spec.ts`) — create tournament → category →
  players/entries → court → match → schedule → court board → dashboard → start →
  score → complete → dashboard reflects the completion.

Run them with `npm test` (unit + integration; database integration skips without
PostgreSQL) and `npm run test:e2e` (requires PostgreSQL and migrations).

## 15. Future extension points

- **Phase 8** adds realtime/multi-device updates on top of this read model; the
  dashboard is already a single derived response, so a push channel can replace
  manual refresh without changing the data shape.
- **Phase 9** covers deployment/Supabase.
- Automatic scheduling optimisation and ranking/seeding remain deliberately
  deferred and would slot in as separate services over the same scheduling port.
