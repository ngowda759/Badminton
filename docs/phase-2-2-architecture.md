# Phase 2.2 — Domain & Application Architecture

Status: implemented on `feature/phase-2-2-domain-application`.

This document records the architecture, decisions and boundaries of the Phase 2.2
domain/application layer that sits between future API/UI layers and Prisma. The
authoritative data model remains
[`docs/phase-2-domain-design.md`](./phase-2-domain-design.md); Phase 2.2 adds no
database changes.

## 1. Layering

```
Future API / UI
      │  (HTTP request → application input)
      ▼
@badminton/validation        Zod input schemas; normalization at the boundary
      ▼
@badminton/application       Services + repository ports + UnitOfWork port
      ▼
@badminton/domain            Pure types, lifecycle tables, normalization, errors
      ▼
@badminton/infrastructure    Prisma repository adapters + error translation
      ▼
PostgreSQL
```

Dependencies point downwards only:

| Package                     | May import                                                           |
| --------------------------- | -------------------------------------------------------------------- |
| `@badminton/domain`         | nothing (framework-free, no runtime deps)                            |
| `@badminton/validation`     | `@badminton/domain`, `zod`                                           |
| `@badminton/application`    | `@badminton/domain`                                                  |
| `@badminton/infrastructure` | `@badminton/application`, `@badminton/domain`, `@badminton/database` |

The domain and application packages import **no** Fastify, HTTP, React, Vite or
Prisma symbols. Prisma is confined to `@badminton/infrastructure` and
`@badminton/database`. This is enforced by review and covered by the lint rules
that already ban non-null assertions and floating promises in these packages.

## 2. Domain layer (`packages/domain`)

Pure, dependency-free building blocks shared by services, validation and tests:

- `tournament.ts` — aggregate types and the status unions (`TournamentStatus`,
  `CategoryStatus`, `EntryStatus`, `StageStatus`, `MatchStatus`, `MatchSlot`,
  `CategoryFormat`, `PlayerGender`, …).
- `lifecycle.ts` — generic `TransitionTable` helpers `isAllowedTransition` and
  `isTerminal`.
- `lifecycle-tables.ts` — the single source of truth for allowed transitions per
  aggregate, plus `TOURNAMENT_REGISTRATION_STATUSES`,
  `CATEGORY_REGISTRATION_STATUS` and `ACTIVE_ENTRY_STATUSES`.
- `normalization.ts` — `normalizeWhitespace`, `normalizeCategoryCode`,
  `isValidCategoryCode`, `normalizeEmail`, `normalizePhone`,
  `normalizeOptionalContact`.
- `dates.ts` — `isValidIanaTimezone`, `toCalendarDate`, `isDateRangeValid`.
- `errors.ts` — the application/domain error model (see §6).

## 3. Validation layer (`packages/validation`)

`createXInputSchema` Zod schemas model the application boundary:

- required fields, string trimming, non-empty names;
- calendar-date parsing to UTC midnight and `endDate >= startDate`;
- valid IANA timezone (`Area/Location` or `UTC`; ambiguous abbreviations such as
  `IST`/`PST`/`GMT` are rejected, per the design);
- enum values for format, gender and statuses;
- positive-integer constraints (`seed`, `sequence`, `roundNumber`, `matchNumber`,
  `slot ∈ {1,2}`, `position`);
- category code normalization to uppercase plus `^[A-Z0-9-]{1,8}$`;
- email lower-casing and phone digit normalization.

Validation gives early, structured errors; it deliberately does **not** try to
reproduce every database constraint. The database remains the final arbiter.

## 4. Application layer (`packages/application`)

### Repository ports

`repositories/index.ts` defines Prisma-agnostic interfaces with domain return
types and plain data objects as inputs:

`TournamentRepository`, `TournamentCategoryRepository`, `PlayerRepository`,
`TeamRepository`, `TeamMemberRepository`, `TournamentEntryRepository`,
`TournamentStageRepository`, `MatchRepository`, `MatchParticipantRepository`,
and a composite `RepositoryClient` that aggregates them.

Ports expose only the operations services need — no raw Prisma client, no
speculative CRUD.

### Transaction port

`repositories/unit-of-work.ts` defines:

```ts
interface UnitOfWork {
  runInTransaction<T>(work: (client: RepositoryClient) => Promise<T>): Promise<T>;
}
```

This is the **only** transaction mechanism. It reuses Prisma's interactive
transaction via the existing client; no second abstraction was introduced.

### Services

Each service is a factory that receives a `UnitOfWork` and returns an interface
value, so dependencies are injected and the services are testable against fake
ports:

- `createTournamentService` — create/update, explicit lifecycle transitions.
- `createTournamentCategoryService` — create/update, code normalization, status
  transitions, entry-count guard.
- `createPlayerService` — create/update with contact normalization.
- `createTeamService` — create (with initial members), add/remove member,
  membership listing.
- `createTournamentEntryService` — `register`/`withdraw`/`confirm`/`disqualify`/
  `update`; the keystone cross-table rules.
- `createTournamentStageService` — create/update, sequence rules, transitions.
- `createMatchService` — create/update, participant assignment, status
  transitions.

## 5. Business rules (services, not repositories)

**Tournament.** Non-empty name; `endDate >= startDate`; valid IANA timezone;
new tournaments start `DRAFT`; explicitly allowed transitions only
(`DRAFT → REGISTRATION_OPEN → REGISTRATION_CLOSED → IN_PROGRESS → COMPLETED`,
with `CANCELLED` reachable from every non-terminal state). Terminal states have
no outgoing transitions.

**Category.** Belongs to a tournament; normalized uppercase code; format
`SINGLES|DOUBLES`; approved gender enum; category lifecycle transitions. The
competitor-kind rule (`SINGLES → player`, `DOUBLES → team`) lives in the entry
service.

**Player.** Trimmed non-empty name; normalized email/phone; duplicate contact
rejection surfaces as `ConflictError`, with the database index as final
enforcement.

**Team.** Globally reusable (no tournament/category columns); duplicate member
prevention; a doubles registration requires a team with exactly two members,
checked by the service, never a trigger.

**Tournament entry.** Registration checks, in order: category exists → category
belongs to its tournament → category is `OPEN` → tournament is
`REGISTRATION_OPEN` → competitor kind matches the format (and a doubles team has
exactly two members) → no duplicate registration → create. Singles requires
`playerId != null, teamId == null`; doubles the inverse. Seed, when supplied,
must be positive. Entries start `PENDING`. Lifecycle: `PENDING ↔ CONFIRMED →
WITHDRAWN|DISQUALIFIED`, terminal thereafter.

**Stage.** Belongs to a category; positive, unique-per-category `sequence`; valid
type; optional draw-size validation; `PENDING → ACTIVE → COMPLETED`. No draw
generation and no automatic match creation.

**Match.** Belongs to a stage; positive `sequence`, `roundNumber`, `matchNumber`;
status lifecycle; participants must use `slot ∈ {1,2}`, one entry cannot occupy
both slots, the entry must exist, be active, and belong to the same category as
the match's stage. No scoring or winner/loser logic.

## 6. Error model (`packages/domain/src/errors.ts`)

A single framework-free hierarchy with stable machine-readable codes:

| Class                         | Code                       | Meaning                            |
| ----------------------------- | -------------------------- | ---------------------------------- |
| `ValidationError`             | `VALIDATION_ERROR`         | application input invalid          |
| `NotFoundError`               | `NOT_FOUND`                | referenced record absent           |
| `ConflictError`               | `CONFLICT`                 | uniqueness/duplicate rule violated |
| `InvalidStateTransitionError` | `INVALID_STATE_TRANSITION` | lifecycle violation                |
| `BusinessRuleViolationError`  | `BUSINESS_RULE_VIOLATION`  | cross-record rule violated         |
| `PersistenceError`            | `PERSISTENCE_ERROR`        | unexpected persistence failure     |

Messages are fixed and safe: no SQL, constraint names, stack traces,
credentials or driver detail. `isApplicationError` lets adapters distinguish
already-typed failures.

## 7. Persistence adapters (`packages/infrastructure`)

`repositories.ts` implements every port over Prisma and maps rows to domain
types via `mappers.ts`. There are no business rules, HTTP concerns or Zod
validation in this layer.

Every repository call is wrapped in `translatePersistenceErrors`, which:

- lets existing application errors pass through unchanged;
- maps `P2002` unique violations to `ConflictError`, resolving the violated
  index from `meta.target` or the driver message and using a fixed, safe message
  per known index (`players_email_key`, `entries_category_team_key`,
  `matches_stageId_sequence_key`, …); unknown targets get a generic message;
- maps `P2003`/`P2014` to `ConflictError`;
- maps `PrismaClientValidationError` to `ValidationError`;
- maps anything else to `PersistenceError`.

Because pre-checks can lose a race, the database unique indexes remain the final
consistency boundary; the adapter turns the resulting violation into a
controlled application error. This is exercised by the concurrency test in §9.

`createPrismaUnitOfWork` adapts the existing `PrismaClient`: one
`$transaction`, a bound `RepositoryClient`, rollback on throw.

## 8. Transaction boundaries

Transactions wrap the multi-write operations:

- team creation together with its initial members;
- tournament-entry registration (read checks + insert);
- member add/remove where more than one row changes;
- match participant assignment (slot/entry checks + insert);
- lifecycle operations that update more than one record.

Because all repository calls accept the transactional `RepositoryClient`, a
service's writes commit or roll back atomically. Rollback is tested in §9.

## 9. Testing

**Unit (`tests/unit`)** — fake in-memory repository ports (`fake-repositories.ts`)
with fixtures, plus pure domain tests:

- `domain/domain-rules.test.ts` — normalization, calendar dates, timezone
  acceptance, lifecycle tables.
- `application/*.service.test.ts` — tournament, category, player/team, entry and
  stage/match rules; singles/doubles compatibility; team-size and
  player-in-two-teams rules; participant slot/eligibility; lifecycle rejections.
- `validation/tournament-inputs.test.ts` — trimming, normalization, enums,
  numeric and date constraints.
- `infrastructure/errors.test.ts` — constraint-to-application-error translation
  and pass-through behaviour.

**Integration (`tests/integration/application`)** — real PostgreSQL, no Prisma
mocks, using the existing `<database>_test` infrastructure with an isolated
`_app_test` database suffix so it can run in parallel with the schema suite. It
drives services through the Prisma unit of work and asserts: persistence and
reload, duplicate-name/code/email/phone conflicts, FK enforcement, atomic team
creation and rollback, duplicate member, duplicate registration and re-register
after withdrawal, format mismatch, player in two teams, tournament-not-open
rejection, duplicate stage/match sequence, duplicate participant slot,
cross-category participant rejection, and a concurrent duplicate-registration
race that resolves to one row plus one `ConflictError`.

The suite skips when no PostgreSQL is reachable and fails the run under `CI` or
`REQUIRE_DATABASE_TESTS=1`.

## 10. Explicitly out of scope

No REST routes, Fastify handlers, React components, auth, draw generation,
scoring, scheduling, rankings, realtime, payments or notifications. No changes to
the approved schema or historical migrations. No speculative CRUD ports.
