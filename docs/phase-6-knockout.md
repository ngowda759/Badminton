# Phase 6 — Knockout stage and bracket management

Status: implemented on `feature/phase-6-knockout`.

This document describes the single-elimination knockout workflow added in
Phase 6: bracket generation, progression of winners through the bracket, bracket
retrieval and the knockout UI. It builds directly on the domain and API from
Phases 2–5; the authoritative design remains
[`phase-2-domain-design.md`](./phase-2-domain-design.md), the layering is
described in [`phase-2-2-architecture.md`](./phase-2-2-architecture.md), the HTTP
surface in [`phase-3-rest-api.md`](./phase-3-rest-api.md), the setup UI in
[`phase-4-tournament-ui.md`](./phase-4-tournament-ui.md) and the scoring workflow
in [`phase-5-group-scoring.md`](./phase-5-group-scoring.md).

Phase 6 **does not change the database schema**. A bracket is stored implicitly in
the existing `matches` and `match_participants` tables.

## 1. Purpose

An operator can take a KNOCKOUT stage from registered competitors to a champion:

```
registered competitors (active entries)
        ↓
generate bracket (caller-supplied ordering)
        ↓
round-1 matches, later rounds with empty slots
        ↓
start a match (SCHEDULED → IN_PROGRESS) once both slots are filled
        ↓
record a result using the existing Phase 5 scoring workflow
        ↓
winner is propagated into the next round's slot, atomically
        ↓
final completed → champion decided → stage completes
```

All bracket maths live in the pure domain; all orchestration and transactions
live in application services. The React UI validates for responsiveness only and
never decides the bracket structure or a winner.

## 2. Architecture

The Phase 2–5 layering is unchanged and enforced:

```
apps/web  (React)
    │  typed API client only
    ▼
REST API  (/api/v1, thin routes)
    │  Zod request-shape validation + response envelope
    ▼
Application services  (KnockoutBracketService, KnockoutProgressionService,
                       MatchResultService)
    │  orchestration + transactions
    ▼
Domain  (bracket.ts — pure)
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

`web → API` only, services depend on ports, the domain depends on nothing, and
Prisma never leaks outside `@badminton/infrastructure` and `@badminton/database`.
Route handlers contain no business rules and do not import Prisma.

## 3. Database changes

**None.** No migration was added and no historical migration was modified.

### Why no `Bracket` table

The existing model already represents everything a single-elimination bracket
needs:

- `TournamentStage` (type `KNOCKOUT`) is the bracket container. `drawSize`, an
  existing nullable `smallint` column, stores the authoritative bracket size once
  generated.
- `Match.roundNumber` and `Match.matchNumber` give each match its bracket
  position; `Match.sequence` gives a stage-unique display order
  (`unique(stageId, sequence)` already exists).
- `MatchParticipant` rows fill slots 1 and 2. A later-round match simply starts
  with **no participant rows** in its slots — an unresolved slot.

Because the destination of a winner is a pure function of `(roundNumber,
matchNumber)` (`bracket.ts`), progression needs no extra relationship table and
no nullable foreign key. Unresolved slots are represented by the _absence_ of a
row, never by a placeholder UUID. This is the smallest model that satisfies the
requirement and needs no schema change.

## 4. Supported bracket sizes

Only powers of two from 2 to 128 are accepted: `2, 4, 8, 16, 32, 64, 128`. Any
other size is rejected with a business-rule error. For a bracket of size `N`:

```
round 1 matches = N / 2
round 2 matches = N / 4
...
final           = 1 match
total matches   = N - 1
rounds          = log2(N)
```

## 5. Bracket structure

Round 1 is the first round played; round `roundCount` is the final. Within a
round, matches are numbered `1..matchesInRound` in bracket order (match 1 is the
top of the bracket). For an 8-entry bracket:

```
Round 1 — Quarterfinals   QF1..QF4   (matchNumber 1..4)
Round 2 — Semifinals      SF1..SF2   (matchNumber 1..2)
Round 3 — Final           F1         (matchNumber 1)
```

`sequence` is contiguous and stable for a bracket size: earlier rounds occupy the
lower values, the final holds the last. It is derived by
`calculateSequence(size, roundNumber, matchNumber)` and never supplied by a
caller.

### Field meanings (explicit)

| Field           | Meaning in a bracket                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| `roundNumber`   | 1 = first round played; `log2(size)` = final. `null` for non-bracket matches. |
| `matchNumber`   | 1-based position within the round (1 = top of the bracket).                   |
| `sequence`      | Stage-unique display order across all rounds.                                 |
| `status`        | Existing match lifecycle (`SCHEDULED` → `IN_PROGRESS` → `COMPLETED`).         |
| `winnerEntryId` | Recorded winner; drives progression.                                          |

## 6. Participant ordering

**Participant ordering is caller-controlled in Phase 6. No automatic seeding or
ranking algorithm is implemented.**

The application/API caller supplies `entryIds` in bracket order. Round 1 pairs
the list in order: position 1 vs 2, 3 vs 4, and so on. For:

```
entryIds: [A, B, C, D, E, F, G, H]
```

the bracket is:

```
QF1 A vs B
QF2 C vs D
QF3 E vs F
QF4 G vs H
```

Later-round matches are created with **empty** slots. No fake entry ids and no
nullable foreign keys are used to stand in for "winner of QF1"; the relationship
is represented by the deterministic `(roundNumber, matchNumber)` mapping, and the
slot is filled only when the earlier match actually completes.

## 7. Progression rules

The winner of match `M` in a round goes to:

```
next roundNumber = roundNumber + 1
next matchNumber = floor((M - 1) / 2) + 1
next slot        = M odd ? 1 : 2
```

For an 8-entry bracket:

```
QF1 winner → SF1 slot 1      (odd)
QF2 winner → SF1 slot 2      (even)
QF3 winner → SF2 slot 1
QF4 winner → SF2 slot 2
SF1 winner → Final slot 1
SF2 winner → Final slot 2
Final winner → champion (no next match)
```

The mapping is generalized for every supported size and covered by domain tests
for 2, 4, 8 and 16.

## 8. Domain layer

`packages/domain/src/bracket.ts` (pure, no runtime dependency, independently
testable):

- `SUPPORTED_BRACKET_SIZES`, `isSupportedBracketSize(size)`
- `calculateRoundCount(size)`
- `calculateMatchesInRound(size, roundNumber)`
- `calculateTotalMatches(size)`
- `calculateNextRoundNumber(roundNumber)`
- `calculateNextMatchNumber(matchNumber)`
- `calculateNextSlot(matchNumber)` → `MatchSlot`
- `calculateNextBracketPosition(roundNumber, matchNumber)` →
  `{ roundNumber, matchNumber, slot }`
- `calculateSequence(size, roundNumber, matchNumber)`
- `bracketRoundName(size, roundNumber)` → `Final` / `Semifinals` /
  `Quarterfinals` / `Round of N`
- `isBracketFinalMatch(size, roundNumber, matchNumber)` → true only for the
  bracket's final (the sole match of the last round)
- `isBracketFinalCompleted(size, roundNumber, matchNumber, status)` → true only
  when that final is `COMPLETED`

No Prisma/database access lives in the domain package.

## 9. Application layer

Two focused services, plus an orchestration hook into match results.

### `KnockoutBracketService`

- `generateBracket(stageId, { entryIds })` — transactional. Verifies the stage
  exists, is `KNOCKOUT`, is not `COMPLETED`, has no existing matches, and that
  every entry belongs to the stage's category, is active (`PENDING`/`CONFIRMED`)
  and unique; the count must be a supported bracket size. It records the size on
  `stage.drawSize`, creates all matches with their `roundNumber`, `matchNumber`
  and `sequence`, and fills round 1 in the supplied order. Later rounds keep
  empty slots.
- `getBracket(stageId)` — reads the bracket in one batched query
  (`listByStageWithParticipants`, no N+1) and derives rounds, round names and the
  completion flag. It completes an `ACTIVE` stage whose final is `COMPLETED`.

### `KnockoutProgressionService`

`progress(client, matchId, winnerEntryId)` propagates a completed match's winner
into the next slot using the **caller's** repository client, so the result
service can pass its transactional client. It verifies the match is `COMPLETED`
and the winner matches, resolves the destination from the bracket maths, and
writes the slot. It is **idempotent**: replaying the same completed match is a
no-op when the slot already holds that winner; a _different_ entry in the slot is
a conflict. A non-`KNOCKOUT` stage, a stage with no `drawSize`, a match without a
bracket position, and the final all return `false` (nothing to advance).

### Repository port

`MatchParticipantRepository.fillSlot(matchId, slot, entryId)` was added (Prisma
implementation + fake) to fill an **empty** slot. It is deliberately create-only,
not an upsert: progression must never overwrite an occupied slot, so the compound
unique index turns a second writer into a conflict instead of replacing the
entry already there. Idempotency is provided by the service, which checks the
current slot first. `listByStageWithParticipants` already existed for batched
bracket reads; no broad repository methods were added.

## 10. Lifecycle behavior

The Phase 2 stage and match lifecycles are reused unchanged. No new state is
introduced.

### Stage

```
PENDING → ACTIVE → COMPLETED
```

- A stage does **not** complete when its matches are created; it completes only
  when the final match is `COMPLETED`. Completion is derived from the final and
  persisted on read (`getBracket`) — there is no background job and no automatic
  completion at generation time.
- The explicit `ACTIVE → COMPLETED` transition is also guarded for KNOCKOUT
  stages: it is rejected with a business-rule error (422) unless the bracket's
  final match is `COMPLETED`. A stage with no generated bracket cannot be
  completed. GROUP stages keep their Phase 5 lifecycle unchanged.
- `PENDING → ACTIVE` is the existing explicit transition, performed by the
  operator before matches can start.

### Bracket immutability

Once a bracket exists (detected from the stage's `matches`, not from a flag):

- its size cannot change — a KNOCKOUT stage update that changes `drawSize` is
  rejected with a business-rule error (422). Re-sending the current value is a
  no-op, so an edit form that round-trips the field keeps working;
- first-round pairing, `roundNumber`, `matchNumber` and `sequence` are fixed at
  generation (the bracket is derived from them);
- a completed match and its result are immutable (Phase 5 rule).

There is no admin "reset bracket" feature.

### Match eligibility

A knockout match may exist as `SCHEDULED` with unresolved participants. The
existing `SCHEDULED → IN_PROGRESS` transition is guarded for KNOCKOUT matches:
both slots must be filled with active entries belonging to the stage's category.
Group matches keep their Phase 5 behavior unchanged.

## 11. API endpoints

All under `/api/v1`; responses use the `{ "data": ... }` envelope and the
centralised `{ "error": { code, message, details } }` model.

| Method | Path                  | Service  | Notes                                       |
| ------ | --------------------- | -------- | ------------------------------------------- |
| `POST` | `/stages/:id/bracket` | knockout | Generates the bracket from `entryIds` (201) |
| `GET`  | `/stages/:id/bracket` | knockout | UI-friendly bracket, or an empty bracket    |

Existing Phase 5 endpoints are reused unchanged:

| Method | Path                      | Purpose                                   |
| ------ | ------------------------- | ----------------------------------------- |
| `POST` | `/matches/:id/transition` | Start a match (`SCHEDULED → IN_PROGRESS`) |
| `POST` | `/matches/:id/result`     | Record a result; triggers progression     |
| `GET`  | `/matches/:id/result`     | Read a completed result                   |

No duplicate scoring endpoints were created.

### `POST /stages/:id/bracket`

Request:

```json
{ "entryIds": ["...", "..."] }
```

Response `201` — the bracket (same shape as `GET`, below).

### `GET /stages/:id/bracket`

Response:

```json
{
  "data": {
    "stageId": "...",
    "stageName": "Knockout",
    "status": "ACTIVE",
    "bracketSize": 4,
    "roundCount": 2,
    "complete": false,
    "rounds": [
      {
        "roundNumber": 1,
        "name": "Semifinals",
        "matches": [
          {
            "matchId": "...",
            "matchNumber": 1,
            "sequence": 1,
            "status": "SCHEDULED",
            "participant1": { "slot": 1, "entryId": "..." },
            "participant2": { "slot": 2, "entryId": "..." },
            "winnerEntryId": null
          }
        ]
      }
    ]
  }
}
```

An unresolved slot has `"entryId": null` (rendered as `TBD`). Prisma models are
never exposed; the application defines `Bracket`, `BracketRound`, `BracketMatch`
and `BracketParticipant` DTOs.

### Validation and error behavior

Zod validates only the request **shape** (`entryIds` is a non-empty array of
UUIDs; the supported-size and category/active rules live in the application and
domain). Errors are mapped centrally to HTTP status codes:

| Situation                                    | Status |
| -------------------------------------------- | ------ |
| Stage not found                              | 404    |
| Stage is not KNOCKOUT / unsupported size     | 422    |
| Duplicate entry ids / bracket already exists | 409    |
| Entry from another category / inactive       | 422    |
| Malformed request body                       | 400    |

## 12. Transaction model

### Bracket generation

One unit of work covers the whole generation: stage/entry validation, all match
inserts and the round-1 participant inserts. A partial bracket is never left
behind. Stage-unique `sequence`/`(stageId, roundNumber, matchNumber)` indexes and
the slot uniqueness constraints are the database's final guard.

### Result + progression (atomic)

```
BEGIN
  validate supplied games (before the transaction)
  load + check match lifecycle
  load participants
  persist MatchGame rows
  derive winner, set winnerEntryId + COMPLETED
  progress winner into the next-round slot
COMMIT   (ROLLBACK on any failure)
```

`MatchResultService.recordResult` runs the progression hook **inside the same
unit of work**, so the result, the recorded winner and the next-round slot commit
atomically or not at all. If progression fails, the whole result rolls back — the
match cannot remain completed with a missing next-round slot due to an internal
error. Progression is never performed in a detached asynchronous operation.

## 13. Concurrency assumptions

Two operators completing the same knockout match at once:

- The match is read inside the transaction; the first completion sets
  `COMPLETED`. The second sees `COMPLETED` and fails with a **conflict** (409).
- `unique(matchId, gameNumber)` prevents duplicated games.
- `fillSlot` is create-only, so a second writer into the same destination slot
  fails on `unique(matchId, slot)` rather than overwriting the entry already
  there; a replayed progression is a no-op because the service checks the slot
  first and sees its own winner.
- A destination slot holding a _different_ entry is a conflict, so two different
  winners can never be propagated into the same slot.

No distributed or external locking is used; PostgreSQL transaction and
constraint behavior is sufficient. This is covered by an integration test that
fires two concurrent result requests at one match.

## 14. Frontend

Extends the Phase 4 UI and reuses its primitives.

- **Stage detail** (`stage-detail.tsx`): a `KNOCKOUT` stage shows a **Knockout
  bracket** card instead of group standings. A `GROUP` stage still shows
  standings.
- **Bracket setup** (`BracketSetup` in `knockout-bracket.tsx`): the operator
  selects active entries, reorders them (up/down), sees the resulting shape and
  confirms in a `ConfirmDialog` before generating. After generation the setup
  disappears and the bracket is read-only — there is no reset/edit affordance.
- **Bracket view** (`KnockoutBracket`): responsive round columns (semifinals,
  final, …); each match card shows the two participants, `TBD` for an unresolved
  slot, the status badge, the winner and a link to the match. No drag-and-drop
  bracket library was added.
- **Match detail** (`match-detail.tsx`): reuses the Phase 5 scoring form and
  result summary. For a knockout match, round/number/sequence are read-only,
  participant assignment is fixed by the bracket, a completed result is
  read-only and the winner progression is shown.
- **Client helpers** (`lib/bracket.ts`) mirror supported sizes and round names
  for immediate feedback; the API remains authoritative.
- No new state-management library; existing hooks are used and affected queries
  are refetched after mutations.

## 15. Limitations

Deliberate Phase 6 limitations:

- Caller-controlled ordering only; no seeding/ranking/draw algorithm.
- Bracket size is a power of two from 2 to 128; no byes for non-power-of-two
  fields.
- Single elimination only; no double elimination, consolation or third-place
  match.
- No bracket reset/edit after generation; a completed result is immutable.
- No automatic advancement without an explicit completed result.
- No result-correction workflow.
- Stage completion is derived on read; there is no background reconciliation.

## 16. Non-goals

Explicitly **not** implemented (later phases): automatic group creation,
automatic draw/ranking/seeding, Elo, federation seeding rules, court allocation,
venue scheduling, time-slot optimization, live scoring, WebSockets/realtime,
authentication/authorization, payments, notifications, public spectator pages,
CSV import/export, AI features, analytics, tournament statistics dashboards,
double elimination, round-robin generation, consolation brackets, third-place
matches, best-of-five scoring, and match-result correction. No Phase 7 work was
started.

## 17. Future extension points

- Seeding/ranking inputs to replace caller-supplied ordering.
- Byes for non-power-of-two fields.
- A result-correction workflow with an audit trail.
- Consolation/third-place brackets, double elimination.
- Automatic group→knockout qualification.
- Court/time scheduling integrated with the bracket.

## 18. Testing

- **Domain unit tests** (`tests/unit/domain/bracket.test.ts`): supported and
  unsupported sizes, round counts, match counts, next-round/match/slot
  calculations, sequences, round names, boundary cases (2, 4, 8, 16).
- **Application unit tests** (`tests/unit/application/knockout.service.test.ts`):
  bracket generation (2/4/8 entries, invalid size, duplicate entries, wrong
  category, inactive entry, already-generated), progression (QF→SF, SF→final,
  correct slot, no duplicate progression, conflicting destination rejected,
  incomplete match rejected, completed match immutable) and stage completion
  (final incomplete → ACTIVE, final completed → COMPLETED, earlier completion
  does not complete the stage).
- **API integration tests** (`tests/integration/api/routes.test.ts`): HTTP
  contract for `POST/GET /stages/:id/bracket` — validation, 400/404/409/422
  mapping, bracket shape, `TBD` slots.
- **PostgreSQL vertical slice** (`tests/integration/api/vertical-slice.test.ts`):
  full HTTP → service → Prisma → PostgreSQL path including bracket generation,
  first-round start, result recording with progression, final champion and stage
  completion, invalid bracket size, withdrawn entry, duplicate generation,
  progression conflict, cross-category entry, concurrent double completion, the
  fill-only slot guarantee and the knockout stage-completion / bracket-size
  guards.
- **Web tests** (`apps/web/src/lib/bracket.test.ts`, `apps/web/tests/flows.test.tsx`):
  bracket helpers, bracket setup with confirmation, bracket render with `TBD`
  slots and winners, no standings for a knockout stage.
- **E2E** (`e2e/knockout-bracket.spec.ts`): the real UI, API and PostgreSQL —
  create tournament → open registration → create category → create four players →
  register entries → create KNOCKOUT stage → generate 4-entry bracket → activate
  the stage → play both semifinals → verify each winner advances → play the final
  → verify the champion and stage completion. Nothing is mocked.
