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

**One additive, forward-only migration:** `add_stage_qualification` adds a
nullable `tournament_stages.qualifiersPerGroup` `smallint` (how many competitors
advance from each group into the feeder knockout) plus a row-local `CHECK` that a
present value is positive. No historical migration was modified and no existing
row is affected.

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

Two ways to supply the draw.

**Caller-controlled ordering (Phase 6).** The application/API caller supplies
`entryIds` in bracket order. Round 1 pairs the list in order: position 1 vs 2, 3
vs 4, and so on. For:

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

**Seeded draw from group qualification (TASK-4).** `pairings` supplies explicit
first-round pairings where `second` may be `null` for a bye. `seedBracket` /
`buildBracketSeed` order the qualifiers: one group keeps standing order, two
groups cross-seed (`A1 vs Bk`, `B1 vs Ak`, …), three or more rank-interleave then
snake-fold. Byes are spread evenly across round one and awarded to the strongest
qualifiers, so a bye seed meets a first-round winner next; a bye is a pairing
with one real competitor and is advanced into round 2 immediately at generation
time. This mirrors the original tournament application's draw.

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

`packages/domain/src/qualification.ts` (pure group→knockout qualification):

- `validateQualificationConfig({ qualifiersPerGroup })`
- `selectQualifiers(config, standingsByGroup, pendingMatchCount)` → the top N of
  each group in standing order; rejects a non-zero `pendingMatchCount` so a
  competitor never advances on stale standings
- `flattenQualifiers(result)` → the qualifiers in group order

`packages/domain/src/bracket-seeding.ts` (pure seeding of the qualifiers):

- `seedBracket(groups)` — one group keeps standing order; two groups use the
  classic cross-seed (`A1 vs Bk`, `B1 vs Ak`, …); three or more rank-interleave
  then snake-fold
- `buildBracketSeed(groups)` → `{ pairings, bracketSize, byeCount, seeds }` — the
  bracket size is the smallest supported size that holds every qualifier, byes
  are spread evenly across round one and awarded to the strongest
  (rank-interleaved) qualifiers, and a bye pairing carries `second: null`

No Prisma/database access lives in the domain package.

## 9. Application layer

Three focused services, plus an orchestration hook into match results.

### `KnockoutBracketService`

- `generateBracket(stageId, command)` — transactional. Verifies the stage
  exists, is `KNOCKOUT`, is not `COMPLETED`, has no existing matches, and that
  every entry belongs to the stage's category, is active (`PENDING`/`CONFIRMED`)
  and unique. The command supplies **either** `entryIds` (the caller-controlled
  ordering, paired 1 vs 2, 3 vs 4, …) **or** `pairings` (explicit first-round
  pairings where `second` may be `null` for a bye); exactly one is required. It
  records the size on `stage.drawSize`, creates all matches with their
  `roundNumber`, `matchNumber` and `sequence`, fills round 1, and immediately
  advances every bye into round 2. Later rounds keep empty slots.
- `generateFromQualifiers(stageId)` — transactional. Reads the feeder groups'
  standings through `QualificationService`, seeds the qualifiers with
  `buildBracketSeed`, and writes the bracket from the resulting pairings. It is
  rejected while any feeder group match is incomplete, so a bracket is never
  built from stale standings.
- `getBracket(stageId)` — reads the bracket in one batched query
  (`listByStageWithParticipants`, no N+1) and derives rounds, round names and the
  completion flag. It completes an `ACTIVE` stage whose final is `COMPLETED`.

### `QualificationService`

`getView(stageId)` returns the derived qualification view of a `KNOCKOUT` stage:
each feeder `GROUP` stage (same category, lower sequence, in sequence order)
contributes its top `qualifiersPerGroup` competitors in standing order. The view
reports readiness, the block reason, the seeds, the bracket size and the bye
count. `resolve(client, stageId)` returns the same resolution for the bracket
generator, so it can pass its **transactional** client and generate atomically.
The service reuses `computeStageStandings` (the same derivation the standings
endpoint uses) and scopes each group's selection to the entries that actually
play in it — a sibling-group entry can never qualify from another group.

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

| Method | Path                           | Service       | Notes                                                     |
| ------ | ------------------------------ | ------------- | --------------------------------------------------------- |
| `POST` | `/stages/:id/bracket`          | knockout      | Generates the bracket from `entryIds` or `pairings` (201) |
| `POST` | `/stages/:id/bracket/generate` | knockout      | Generates the bracket from the group qualifiers (201)     |
| `GET`  | `/stages/:id/bracket`          | knockout      | UI-friendly bracket, or an empty bracket                  |
| `GET`  | `/stages/:id/qualification`    | qualification | Derived group→knockout qualification view                 |

Existing Phase 5 endpoints are reused unchanged:

| Method | Path                      | Purpose                                   |
| ------ | ------------------------- | ----------------------------------------- |
| `POST` | `/matches/:id/transition` | Start a match (`SCHEDULED → IN_PROGRESS`) |
| `POST` | `/matches/:id/result`     | Record a result; triggers progression     |
| `GET`  | `/matches/:id/result`     | Read a completed result                   |

No duplicate scoring endpoints were created.

### `POST /stages/:id/bracket`

Request — exactly one of the two shapes:

```json
{ "entryIds": ["...", "..."] }
```

```json
{
  "pairings": [
    { "first": "...", "second": "..." },
    { "first": "...", "second": null }
  ]
}
```

`pairings` is how a seeded draw with byes is supplied: `second: null` is a bye,
and the competitor is advanced into round 2 immediately. Supplying both, or
neither, is a `400`.

Response `201` — the bracket (same shape as `GET`, below).

### `POST /stages/:id/bracket/generate`

No body. Reads the feeder `GROUP` stages' standings, seeds the qualifiers
(cross-seed for two groups, rank-interleave + snake-fold for three or more),
spreads byes and writes the bracket in one transaction. Response `201` — the
bracket. Rejected with `422` while any feeder group match is incomplete (or no
group stage feeds the knockout / the qualifier count is unset), and `409` when a
bracket already exists.

### `GET /stages/:id/qualification`

Response:

```json
{
  "data": {
    "knockoutStageId": "...",
    "knockoutStageName": "Knockout",
    "qualifiersPerGroup": 2,
    "groups": [
      {
        "groupId": "...",
        "groupName": "Group A",
        "sequence": 1,
        "qualifyingCount": 2,
        "competitorCount": 4,
        "qualifiers": [{ "entryId": "...", "position": 1 }],
        "complete": true,
        "totalMatches": 6,
        "completedMatches": 6
      }
    ],
    "seeds": ["..."],
    "qualifierCount": 4,
    "bracketSize": 4,
    "byeCount": 0,
    "ready": true,
    "blockedReason": null,
    "bracketGenerated": false,
    "standingsByGroup": { "<groupId>": [] }
  }
}
```

Read-only; it never advances anything and never mutates state.

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

Deliberate limitations (Phase 6 plus TASK-4 progression):

- Caller-controlled ordering remains available; the seeded draw is derived from
  group qualification (`qualifiersPerGroup`), not from a ranking/Elo system.
- Bracket size is a power of two from 2 to 128; a non-power-of-two qualifier
  field is padded with byes, which are spread evenly and awarded to the strongest
  (rank-interleaved) qualifiers.
- Single elimination only; no double elimination, consolation or third-place
  match.
- No bracket reset/edit after generation; a completed result is immutable except
  through the result-correction workflow (TASK-9/AI-003), which re-derives the
  bracket from the corrected match downward.
- No automatic advancement without an explicit completed result; a bye is the one
  exception, advanced at generation time.
- A corrected result re-derives the bracket; there is no correction history or
  audit trail (V1 has none).
- Stage completion is derived on read; there is no background reconciliation.

## 16. Non-goals

Explicitly **not** implemented (later phases): automatic group creation, Elo,
federation seeding rules, court allocation, venue scheduling, time-slot
optimization, live scoring, WebSockets/realtime, authentication/authorization,
payments, notifications, public spectator pages, CSV import/export, AI features,
analytics, tournament statistics dashboards, double elimination, consolation
brackets, third-place matches, best-of-five scoring, and an audit trail for
match-result correction. Group→knockout qualification is now implemented
(TASK-4) and is no longer a non-goal, and match-result correction is now
implemented (TASK-9/AI-003).

## 17. Future extension points

- Ranking/Elo inputs to replace the group-standing draw.
- An audit trail / correction history for the result-correction workflow.
- Consolation/third-place brackets, double elimination.
- Court/time scheduling integrated with the bracket.

## 18. Testing

- **Domain unit tests** (`tests/unit/domain/bracket.test.ts`): supported and
  unsupported sizes, round counts, match counts, next-round/match/slot
  calculations, sequences, round names, boundary cases (2, 4, 8, 16).
- **Domain qualification/seeding tests**
  (`tests/unit/domain/qualification.test.ts`,
  `tests/unit/domain/bracket-seeding.test.ts`): config validation, top-N
  selection, clamping to a small group, ordering by standing position, rejection
  while a match is outstanding; one-/two-/three-group seeding, uneven fields,
  bracket sizing, bye spreading and never pairing two byes.
- **Application unit tests** (`tests/unit/application/knockout.service.test.ts`):
  bracket generation (2/4/8 entries, invalid size, duplicate entries, wrong
  category, inactive entry, already-generated), progression (QF→SF, SF→final,
  correct slot, no duplicate progression, conflicting destination rejected,
  incomplete match rejected, completed match immutable) and stage completion
  (final incomplete → ACTIVE, final completed → COMPLETED, earlier completion
  does not complete the stage).
- **Application progression tests**
  (`tests/unit/application/tournament-progression.test.ts`): the whole
  setup → groups → fixtures → standings → qualification → knockout → final →
  completion slice, bye auto-advance for an odd field, refusal to advance while a
  group match is outstanding, a group with no configured qualifier count, and a
  knockout with no feeder group.
- **API integration tests** (`tests/integration/api/routes.test.ts`): HTTP
  contract for `POST/GET /stages/:id/bracket` — validation, 400/404/409/422
  mapping, bracket shape, `TBD` slots. `tests/integration/api/qualification.routes.test.ts`
  covers `GET /stages/:id/qualification` and `POST /stages/:id/bracket/generate`
  (200/201/404/409/422), explicit `pairings` with a bye, the both/neither `400`,
  and `qualifiersPerGroup` validation.
- **PostgreSQL vertical slice** (`tests/integration/api/vertical-slice.test.ts`):
  full HTTP → service → Prisma → PostgreSQL path including bracket generation,
  first-round start, result recording with progression, final champion and stage
  completion, invalid bracket size, withdrawn entry, duplicate generation,
  progression conflict, cross-category entry, concurrent double completion, the
  fill-only slot guarantee and the knockout stage-completion / bracket-size
  guards; plus the TASK-4 slice that runs two groups of four through
  qualification into the bracket and champion without inserting any row directly.
- **Web tests** (`apps/web/src/lib/bracket.test.ts`, `apps/web/tests/flows.test.tsx`,
  `apps/web/src/components/tournaments/qualification-panel.test.tsx`):
  bracket helpers, bracket setup with confirmation, bracket render with `TBD`
  slots and winners, no standings for a knockout stage, the qualification card
  (blocked/ready/generate) and the `qualifiersPerGroup` stage configuration.
- **E2E** (`e2e/knockout-bracket.spec.ts`): the real UI, API and PostgreSQL —
  create tournament → open registration → create category → create four players →
  register entries → create KNOCKOUT stage → generate 4-entry bracket → activate
  the stage → play both semifinals → verify each winner advances → play the final
  → verify the champion and stage completion. Nothing is mocked.
- **E2E** (`e2e/tournament-progression.spec.ts`): the complete TASK-4 flow —
  two groups of four configured with `qualifiersPerGroup` in the UI, round-robins
  generated and played, standings verified, qualification derived from the
  standings, bracket generated from the qualifiers, both semifinals and the final
  played, the tournament completed, and the final state verified after a reload.
