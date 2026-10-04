# AI-007 — Tournament backup export and reset (TASK-13, parity gap G9)

| Field          | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Task id        | `AI-007`                                                |
| Phase          | parity (G9 from the TASK-5 audit)                       |
| Status         | approved                                                |
| Human approval | not required — the brief is the implementation contract |
| Depends on     | AI-006                                                  |

## Summary

The TASK-5 parity audit records gap **G9** as a **high-severity** operator-workflow
gap: V1 can export the whole tournament as a JSON backup and reset it
(`exportJSON`/`importJSON`/`resetTournament`, `index.html:1826-1845`, `2147-2170`;
the Settings *Backup* and *Danger zone* cards at `index.html:6175-6200`), whereas
V2 has **no export, import or reset at all** (audit §14). A mis-created or
abandoned tournament is therefore permanent in V2, and an operator cannot snapshot
a tournament before a destructive change.

V2 is **server-backed**, so a whole-database import that re-creates rows under
operator-supplied UUIDs is neither safe nor faithful to the server-owned identity
model, and the public API deliberately exposes no list-all endpoints (entries and
stages are read **per category**). A lossless import would need new read surface
for every aggregate. This task therefore delivers the two halves of G9 that are
safe, high-value and **migration-free** — the JSON backup **export** and the
guarded **reset** — and defers the import to its own task.

- **Export** (`GET /api/v1/tournaments/:id/export`) is a pure read: the whole
  tournament assembled from the existing per-tournament repository reads
  (tournament, categories, stages, courts, entries, matches, participants and
  games) in one derived response. It records no event and opens no transaction.
- **Reset** (`POST /api/v1/tournaments/:id/reset`) is a guarded destructive
  operation on a **non-terminal** tournament. In one
  `UnitOfWork.runInTransaction` it clears every match's result and schedule
  (deletes the stored games, clears the winner, returns the match to `SCHEDULED`
  and nulls the court and times) and reopens every `ACTIVE`/`COMPLETED` stage to
  `PENDING`, so a tournament can be re-played without deleting it. A `COMPLETED`
  or `CANCELLED` tournament is refused.

## Confirmed V1 behaviour

- `exportJSON()` (`index.html:2147`) returns the whole state as JSON; the Settings
  *Backup* card downloads it as `Tournament-backup-<stamp>.json`
  (`index.html:6311-6325`).
- `resetTournament()` (`index.html:2166`) clears storage and rebuilds the default
  example configuration. V1's *Clear results only* (`askClearResults`,
  `index.html:6355-6370`) is the closer analogue of this task's reset: it keeps the
  teams and fixtures but clears every recorded score and the knockout bracket.
- V1's default example configuration is a **client** concept and has no
  server-side counterpart; restoring it is explicitly out of scope here.

## Repository state after AI-006

- `TournamentService` (`packages/application/src/services/tournament.service.ts`)
  exposes `create`, `update`, `transitionStatus`, `getById` and `list`; there is no
  export or reset.
- `MatchRepository` (`packages/application/src/repositories/index.ts`) has
  `create`, `createMany`, `update`, `updateStatus`, `complete`, `clearResult`,
  `schedule`, `unschedule`, `remove`, `listByStage`, `listByTournament`, … A reset
  needs to clear a **result and a schedule together** in one write; `clearResult`
  clears only the result and `unschedule` clears only the schedule, so the task
  adds one single-row `MatchRepository.reset` that clears the winner, the status
  (to `SCHEDULED`) and the schedule in one update. This is not a multi-row
  operation, so it does not require a migration.
- `MatchGameRepository.deleteByMatch` already removes a match's games;
  `TournamentStageRepository.updateStatus` already changes a stage's status;
  `STAGE_TRANSITIONS` (`packages/domain/src/lifecycle-tables.ts`) allows
  `ACTIVE → COMPLETED` but **not** `COMPLETED → PENDING`, so a completed stage is
  reopened with a direct `updateStatus('PENDING')`, the same mechanism the
  knockout correction already uses to reopen a `COMPLETED` stage.
- The realtime catalogue (`packages/domain/src/realtime.ts`,
  `packages/application/src/realtime/event-types.ts`) already has
  `MATCH_UNSCHEDULED` and `STAGE_STATUS_CHANGED`, so reset introduces **no new
  event type** and the exact-list assertion in
  `tests/unit/domain/realtime.test.ts` stays unchanged.

## Design

### Export

`TournamentBackupService.export(tournamentId)` reads, once each for the whole
tournament:

- `tournaments.findById`
- `categories.listByTournament`
- `stages.listByTournament`
- `courts.listByTournament`
- `entries.listByTournament`
- `matches.listByTournament`
- `matchParticipants.listByMatchIds(matchIds)`
- `matchGames.listByMatchIds(matchIds)`

and returns a plain, JSON-serialisable `TournamentBackup` (the aggregate rows,
which already serialise to ISO dates). It is a read, so it opens no transaction
and records no event. An unknown id raises `NotFoundError`. The route maps the
backup through a DTO (never a raw Prisma/domain model) and returns it in the
standard `{ data }` envelope.

### Reset

`TournamentResetService.reset(tournamentId)` runs in exactly one
`UnitOfWork.runInTransaction`:

1. Load the tournament; reject a `COMPLETED` or `CANCELLED` tournament with
   `ConflictError`, and an unknown id with `NotFoundError`.
2. Read the tournament's matches, stages and games once (batched).
3. For every match, `tx.matches.reset(match.id)` (clears winner + schedule,
   status → `SCHEDULED`) and `tx.matchGames.deleteByMatch(match.id)` when it had
   games, recording `MATCH_UNSCHEDULED` only for a match that actually held a
   schedule.
4. For every stage whose status is `ACTIVE` or `COMPLETED`,
   `tx.stages.updateStatus(stage.id, 'PENDING')` and record
   `STAGE_STATUS_CHANGED`.

Entries, categories, courts and the tournament's own status are untouched. A
second reset is idempotent: every match is already `SCHEDULED` with no schedule
and every stage is already `PENDING`, so nothing changes and no event is written.

## Acceptance criteria

See the task queue entry for the full list. In short:

- `tests/unit/application/tournament-backup.service.test.ts` and
  `tests/unit/application/tournament-reset.service.test.ts` prove the export
  shape / no-transaction / no-event behaviour and the reset clearing,
  stage-reopen, refusal and idempotency behaviour.
- `tests/unit/application/transaction-boundaries.test.ts` records zero
  transactions for export and exactly one for reset.
- `tests/integration/api/tournament-backup.routes.test.ts` proves the HTTP
  contract (200/404 for export; 200/409/404 for reset) and that a reset match is
  `SCHEDULED` with no winner.
- `apps/web/src/pages/tournaments/tournament-details.test.tsx` proves the export
  download and the reset ConfirmDialog flow.
- `e2e/tournament-reset.spec.ts` proves the real UI/API/PostgreSQL flow.
- No migration, seed or workflow change; the realtime catalogue is unchanged.

## Out of scope

- Importing a backup (a separate task).
- A per-match or per-stage clear-results endpoint; reset is tournament-scoped.
- Deleting the tournament, its courts, categories, stages or entries.
- Restoring V1's default example configuration on reset.
- Any change to the lifecycle transition tables or `MatchService.transitionStatus`.
- A new realtime event type or a second data-fetching framework.
- The remaining TASK-5 gaps (G7/G8, G10, G12, G13, G14, G16).
- Production data, credentials, or a hand merge.
