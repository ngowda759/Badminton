# Phase 5 — Group-stage scheduling and scoring

Status: implemented on `feature/phase-5-group-scoring`.

This document describes the first real competition workflow added in Phase 5:
group-stage match scheduling, match scoring, winner determination, match
completion and group standings. It builds directly on the domain and API from
Phases 2–4; the authoritative design remains
[`phase-2-domain-design.md`](./phase-2-domain-design.md), the layering is
described in [`phase-2-2-architecture.md`](./phase-2-2-architecture.md), the HTTP
surface in [`phase-3-rest-api.md`](./phase-3-rest-api.md) and the setup UI in
[`phase-4-tournament-ui.md`](./phase-4-tournament-ui.md).

Phase 5 is the first phase to change the database since Phase 2: it adds
persisted match results.

## 1. Objective

An operator can take a GROUP stage from registered competitors to a completed
result and a derived table:

```
registered competitors
        ↓
group-stage match
        ↓
two participants (slots 1 and 2)
        ↓
start match (SCHEDULED → IN_PROGRESS)
        ↓
enter valid badminton scores
        ↓
complete match (validate → persist games → determine winner)
        ↓
standings automatically reflect the result
```

All scoring rules and invariants are enforced by the domain, application and API
layers. The React UI validates for responsiveness only and never decides a
winner.

## 2. Architecture

```
apps/web  (React)
    │  typed API client only
    ▼
REST API  (/api/v1, thin routes)
    │  Zod request-shape validation + response envelope
    ▼
Application services  (MatchResultService, StandingsService)
    │  orchestration + transactions
    ▼
Domain  (scoring.ts, standings.ts — pure)
    │
    ▼
Repository ports  (RepositoryClient, UnitOfWork)
    │
    ▼
Infrastructure  (Prisma repositories, error translation)
    │
    ▼
PostgreSQL
```

Dependency direction is unchanged and enforced: `web → API` only, services
depend on ports, the domain depends on nothing, and Prisma never leaks outside
`@badminton/infrastructure` and `@badminton/database`.

## 3. Database changes

One new migration: `prisma/migrations/20260927145141_add_match_scoring/`. No
historical migration was modified.

### New model — `match_games`

One row per game in a best-of-three match. Points belong to the two
`MatchParticipant` slots (1 and 2), so the model is agnostic to singles and
doubles; the winning slot is stored so a completed result can be read back
without re-deriving it.

| Column               | Type             | Notes                               |
| -------------------- | ---------------- | ----------------------------------- |
| `id`                 | `uuid`           | primary key                         |
| `matchId`            | `uuid`           | FK → `matches`, `ON DELETE CASCADE` |
| `gameNumber`         | `smallint`       | 1-based, 1–3                        |
| `participant1Points` | `smallint`       | 0–30                                |
| `participant2Points` | `smallint`       | 0–30                                |
| `winnerSlot`         | `smallint`       | 1 or 2                              |
| `createdAt`          | `timestamptz(3)` | default `now()`                     |
| `updatedAt`          | `timestamptz(3)` |                                     |

Uniqueness: `unique(matchId, gameNumber)`.

### `matches.winnerEntryId`

A nullable `uuid` column and FK → `tournament_entries` (`ON DELETE RESTRICT`),
plus an index. It holds the derived winner of a completed match and is set in the
same transaction that completes the match. It is never supplied by a caller.

### Row-local CHECK constraints

Prisma cannot express these, so they are hand-written in the migration. They are
true row-local invariants only; the full badminton scoring rules stay in the
domain layer.

- `match_games_number_valid`: `gameNumber IN (1, 2, 3)`
- `match_games_points_in_range`: both point columns `BETWEEN 0 AND 30`
- `match_games_winner_slot_valid`: `winnerSlot IN (1, 2)`
- `match_games_winner_matches_points`: the winner slot has the higher score

Cross-row and cross-table rules (best-of-three completeness, two participants,
same-category participants) are **not** in the database; they belong to the
domain/application services.

## 4. Scoring model

```
Match
 ├── MatchParticipant (slot 1)  ──→ Entry
 ├── MatchParticipant (slot 2)  ──→ Entry
 └── MatchGame[]
       ├── gameNumber
       ├── participant1Points
       ├── participant2Points
       └── winnerSlot
```

`winnerSlot` is derived from the points, never chosen. Player/team ids never
appear in scoring; the model reasons only about slots, so doubles works exactly
as singles.

## 5. Badminton scoring rules implemented

Implemented in `packages/domain/src/scoring.ts` (pure, no runtime dependency).

### A game

- Won at **21** points with a **two-point** margin.
- Extended while the margin stays at one (22-20, 25-23, …).
- Hard **30-point ceiling**: at 30 a single-point lead wins (30-29 is legal).

| Score | Valid | Reason                     |
| ----- | ----- | -------------------------- |
| 21-0  | yes   | target reached, margin ≥ 2 |
| 21-19 | yes   | margin 2                   |
| 22-20 | yes   | extended, margin 2         |
| 25-23 | yes   | extended, margin 2         |
| 30-29 | yes   | ceiling, margin 1 allowed  |
| 30-28 | yes   | ceiling, margin 2          |
| 20-0  | no    | target not reached         |
| 21-20 | no    | margin 1 below the ceiling |
| 30-30 | no    | tied                       |
| 31-29 | no    | above the ceiling          |

### A match

Best of three: the winner is the first slot to win **two** games (2-0 or 2-1).

| Games               | Valid | Reason                                   |
| ------------------- | ----- | ---------------------------------------- |
| 21-15, 21-18        | yes   | 2-0                                      |
| 21-18, 18-21, 21-19 | yes   | 2-1                                      |
| 21-18, 21-19, 21-15 | no    | a third game after the match was decided |
| 21-18, 18-21        | no    | 1-1 is undecided (incomplete)            |
| 21-18               | no    | fewer than two games                     |

### Domain functions

- `isValidGameScore(points1, points2): boolean`
- `determineGameWinner(points1, points2): MatchSlot`
- `validateGameScore(points1, points2, gameNumber): void`
- `scoreMatchGames(games): MatchGame[]` — validates and scores a full result
- `determineMatchOutcome(games): MatchOutcome` — derives the winner from stored games

Constants: `GAME_POINT_TARGET = 21`, `GAME_POINT_CEILING = 30`,
`GAME_MIN_MARGIN = 2`, `MIN_GAMES_PER_MATCH = 2`, `MAX_GAMES_PER_MATCH = 3`,
`GAMES_TO_WIN_MATCH = 2`.

These rules are deliberately **not** labelled an official federation rule set;
they follow the widely-used Laws of Badminton scoring and can be replaced later.

## 6. Match lifecycle

The Phase 2 lifecycle is reused unchanged. Scoring respects it:

| Status        | Can                                 | Cannot                                |
| ------------- | ----------------------------------- | ------------------------------------- |
| `SCHEDULED`   | assign participants, begin match    | record a completed result             |
| `IN_PROGRESS` | enter/update scores, complete match | —                                     |
| `COMPLETED`   | —                                   | be scored or edited; result immutable |
| `CANCELLED`   | —                                   | be scored                             |

- **Start** uses the existing `SCHEDULED → IN_PROGRESS` transition
  (`POST /matches/:id/transition`). No new "start" concept is introduced.
- **Completion is not a bare transition.** `POST /matches/:id/transition` with
  `COMPLETED` is rejected with a business error; a match reaches `COMPLETED` only
  by recording a validated result.
- `COMPLETED` results are **immutable**. No result-correction workflow is
  provided in this phase.

## 7. Result lifecycle

`MatchResultService.recordResult` performs the completion atomically:

1. Validate the supplied games with the domain scoring rules (before any
   transaction — an invalid score never reaches the database).
2. Open a unit of work.
3. Load the match; reject if missing, already `COMPLETED` (conflict) or not
   `IN_PROGRESS`.
4. Load participants; require exactly slot 1 and slot 2.
5. Persist all games in one `createManyAndReturn`.
6. Derive the winner and write `winnerEntryId` + `COMPLETED` in one update.

If any step fails, the transaction rolls back and no partial result remains.

`MatchResultService.getResult` returns the stored result of a completed match, or
`undefined` when the match is not complete. It derives the winner independently
from the stored games.

## 8. Standings calculation

Standings are **derived, never stored**. `StandingsService.getStageStandings`
reads the completed matches of the stage's category (only GROUP stages have
standings), resolves participants and games in two batched queries (no N+1) and
hands the data to the pure `calculateStandings` domain function.

Every active category entry appears, even before playing, so the full group is
visible from the start.

Per competitor: `played`, `won`, `lost`, `points` (2 for a win, 1 for a loss),
`gamesWon`, `gamesLost`, `gameDifference`, `pointsFor`, `pointsAgainst`,
`pointDifference`, `position`.

### Tie-breaking order

Deterministic and documented — deliberately simple, **not** an official
federation rule:

1. matches won, descending
2. game difference, descending
3. point difference, descending
4. entry id ascending (stable final tie-break)

If tournament rules later need a different order, it can be made configurable in
a later phase.

## 9. API endpoints added

All under `/api/v1`; responses use the `{ "data": ... }` envelope and the
centralised `{ "error": { code, message, details } }` model.

| Method | Path                    | Service      | Notes                                                    |
| ------ | ----------------------- | ------------ | -------------------------------------------------------- |
| `POST` | `/matches/:id/result`   | matchResults | Records a validated result and completes the match (201) |
| `GET`  | `/matches/:id/result`   | matchResults | Stored result of a completed match, or `null`            |
| `GET`  | `/stages/:id/standings` | standings    | Derived table for a GROUP stage                          |

`POST /matches/:id/transition` is unchanged and still used to start a match; it
rejects `COMPLETED`.

## 10. Validation

`packages/validation` adds `recordMatchGameInputSchema` and
`recordMatchResultInputSchema`:

- game number: positive integer, max 3
- points: coerced integer, 0–30
- result: 1–3 games

Zod validates the request **shape** only. Whether a score is a legal badminton
result is a domain rule enforced by `scoreMatchGames` in the application layer.

## 11. Transaction boundary

Transactional (one unit of work):

```
record match result
    ↓ validate (before the transaction)
    ↓ load + check match lifecycle
    ↓ load participants
    ↓ persist games
    ↓ derive winner, set winnerEntryId + COMPLETED
```

Reads — `getResult`, `getStageStandings`, listing matches — open no transaction.

## 12. Concurrency behaviour

Two operators completing the same match at once:

- The match is read inside the transaction; the first to complete sets
  `COMPLETED`.
- A second completion sees `COMPLETED` and fails with a **conflict** (409).
- `unique(matchId, gameNumber)` is the database's final guard against duplicated
  games.

No distributed locking is used; PostgreSQL transaction/constraint behaviour is
sufficient. The behaviour is covered by an integration test against real
PostgreSQL.

## 13. Testing

- **Domain unit tests** (`tests/unit/domain/scoring.test.ts`,
  `standings.test.ts`): game validity (21-0, 21-19, 22-20, 30-29, 30-28;
  rejected 20-0, 21-20, 30-30, 31-29), winner determination, 2-0/2-1 validity,
  rejected 1-1 and three-games-after-2-0, standings maths, tie-break order.
- **Application unit tests** (`tests/unit/application/match-result.service.test.ts`):
  result recording, lifecycle rules, eligibility, idempotent conflict,
  transactional rollback, derived standings.
- **API integration tests** (`tests/integration/api/routes.test.ts`): HTTP
  contract for `/result` and `/standings` — valid/invalid scores, 30-point rule,
  one-game and three-game-after-2-0, missing/duplicate participants, wrong
  lifecycle, conflict, 400/404/409/422 mapping.
- **PostgreSQL vertical slice** (`tests/integration/api/vertical-slice.test.ts`):
  full HTTP → service → Prisma → PostgreSQL path, including rollback on failure
  and conflicting concurrent completion.
- **Database integration tests**
  (`tests/integration/database/tournament-database.test.ts`): `match_games` CHECK
  constraints, uniqueness, cascade and index presence.
- **Web unit/component tests** (`apps/web/src/lib/scoring.test.ts`,
  `.../match-scoring.test.tsx`, `apps/web/tests/flows.test.tsx`): score
  validation, scoring form, read-only completed result, standings render/empty/
  loading/error states.
- **E2E** (`e2e/group-scoring.spec.ts`): the real UI, API and PostgreSQL —
  create tournament → open registration → create category → create two players →
  register both → create GROUP stage → create match → assign both slots → start →
  enter 21-18, 21-15 → complete → verify winner and standings. Nothing is mocked.

## 14. Frontend

Extends the Phase 4 UI and reuses its primitives (`AppShell`, `PageHeader`,
`StatusBadge`, `LoadingState`, `EmptyState`, `ErrorState`, `ConfirmDialog`,
`FormField`, `Table`, `Card`) and the typed API client.

- **Match detail** (`match-detail.tsx`): adds a scoring card for `IN_PROGRESS`
  matches (per-game number inputs, `min=0`, `max=30`), derived game/match winner
  indicators, and a read-only result summary for `COMPLETED` matches. There is no
  edit affordance for a completed result.
- **Stage detail** (`stage-detail.tsx`): adds a Standings section for GROUP
  stages and a result/winner column in the match list.
- **Components**: `match-scoring.tsx`, `match-result-summary.tsx`,
  `standings-table.tsx`.
- **Client-side validation** (`lib/scoring.ts`) mirrors the domain rules for
  immediate feedback; the API remains authoritative. The user cannot pick a
  winner — it is always derived from the scores.
- Score inputs carry accessible labels such as `Game 1 — <name> points`.

No new state-management library was added; the existing lightweight hooks are
used and affected queries are refetched after mutations.

## 15. Non-goals

Not implemented (later phases):

- knockout bracket / draw generation, automatic group creation or advancement
- court assignment, venue scheduling, time-slot optimisation
- ranking / seed-based ranking, Elo, rating systems
- authentication, authorization, payments
- realtime / WebSocket updates, notifications, analytics
- public spectator pages, mobile app, CSV import/export, AI features
- result correction workflow
- caching layers, Redis, queues, background workers, external scoring services

## 16. Future work

- Optional result-correction workflow with an audit trail.
- Configurable standings tie-break order per tournament.
- Named groups (`StageGroup`) if the workflow needs them; the current model uses
  the stage itself as the group, which was sufficient for Phase 5.
- Automatic draw/bracket generation and knockout advancement.
- Ranking/seed integration and court/time scheduling.
