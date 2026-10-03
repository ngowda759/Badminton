# AI-006 — Guarded group-fixture regeneration (TASK-12, parity gap G15)

| Field          | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Task id        | `AI-006`                                                |
| Phase          | parity (G15 from the TASK-5 audit)                      |
| Status         | approved                                                |
| Human approval | not required — the brief is the implementation contract |
| Depends on     | AI-005                                                  |

## Summary

The TASK-5 parity audit records gap **G15** as a medium-severity operator-workflow
gap: V1 lets an operator **regenerate** a group's fixtures from the current
membership with a confirmation that shows the before/after plan
(`regeneratePlan`/`regenerateFixtures`, `index.html:3440-3452`), whereas V2
generates fixtures **once** and then answers any second attempt with a hard `409`
(`GroupFixtureService.generate`, `packages/application/src/services/group-fixture.service.ts`).
A group whose membership or ordering was mis-entered is therefore permanent short
of deleting the whole stage.

This task closes G15 with the smallest coherent change: a **guarded
regeneration** of a GROUP stage's round-robin through
`POST /api/v1/stages/:id/fixtures/regenerate`. Regeneration is allowed only for a
GROUP stage that is **not `COMPLETED`** and **already has fixtures**; it replaces
the whole fixture set (all existing matches of the stage and, by the database
cascade, their participants and games) with a freshly generated round-robin in
one transaction, so a partially regenerated group is never left behind. A
`COMPLETED` stage is refused (its results are the group's outcome and
`STAGE_TRANSITIONS` makes `COMPLETED` terminal); a stage with no fixtures to
replace is refused (regeneration is not a synonym for generation).

V1's richer **before/after plan preservation** — keeping results for pairings that
still exist — is explicitly **out of scope**: this task adopts the simpler, safe
"discard and regenerate from the current membership" reading, matching the
existing `generate` semantics. The regeneration is an operator action whose
confirmation dialog warns that recorded results will be discarded.

## Confirmed V1 behaviour

- `regeneratePlan()` / `regenerateFixtures()` (`index.html:3440-3452`) rebuild a
  group's fixtures from the current membership; V1 shows a before/after plan and
  requires confirmation before applying it.
- V1's `removeGroup`/`addGroup` never silently regenerate; regeneration is an
  explicit operator step (audit §5, §6).
- V2 already owns the pure round-robin (`roundRobinRounds`,
  `packages/domain/src/round-robin.ts`) and the whole-set write in one
  `UnitOfWork.runInTransaction` (`GroupFixtureService.generate`); regeneration
  reuses both and adds only the replace step.

## Repository state after AI-005

- `GroupFixtureService` (`packages/application/src/services/group-fixture.service.ts`)
  exposes only `generate(stageId, command)`. It validates the caller's ordering
  (≥2 entries, all in the stage's category, all active, no duplicates), rejects a
  non-GROUP stage, a `COMPLETED` stage and a stage that already has matches
  (`ConflictError`), then writes the whole round-robin in one transaction via
  `tx.matches.create` + `tx.matchParticipants.create`.
- `MatchRepository` (`packages/application/src/repositories/index.ts`) has
  `create`, `createMany`, `update`, `complete`, `clearResult`, `schedule`, … but
  **no `remove`**. `matches` is referenced by `stageId` with `onDelete: Restrict`,
  and `MatchParticipant`/`MatchGame` both reference `match` with
  `onDelete: Cascade` (`prisma/schema.prisma:264,289`), so deleting a match row
  already removes its participants and games.
- The API route is `POST /api/v1/stages/:id/fixtures`
  (`apps/api/src/http/routes/stage-match.routes.ts:166`), wired to
  `groupFixtures` in `ApiServices`; there is **no** regenerate route.
- The web client method is `StageApi.generateFixtures`
  (`apps/web/src/api/services.ts`) and the operator control is
  `GroupFixtureSetup` (`apps/web/src/components/tournaments/group-fixture-setup.tsx`),
  mounted by `StageDetailPage` (`apps/web/src/pages/tournaments/stage-detail.tsx`).
  Once fixtures exist, the setup component disappears and the match list is
  authoritative; the page already refetches its queries through
  `useTournamentRefresh` and a local `mutation`/`ConfirmDialog` pattern exists on
  the same page for stage removal.
- `STAGE_TRANSITIONS` (`packages/domain/src/lifecycle-tables.ts:42`) is
  `PENDING → ACTIVE → COMPLETED`, `COMPLETED: []` — a completed stage cannot be
  reopened, so its fixtures must not be regenerated.
- The realtime catalogue (`packages/domain/src/realtime.ts`,
  `packages/application/src/realtime/event-types.ts`) is an exact, tested list.
  This task adds **no** new event type; regeneration is surfaced by the client's
  own tournament-scoped refetch, exactly as stage and court removal are (a bulk
  fixture reset is an operator action, not a live-tournament event the catalogue
  models).

## Implementation

1. **Repository port + adapters.** Add `remove(id: string): Promise<void>` to
   `MatchRepository` and implement it in
   `packages/infrastructure/src/repositories.ts` (`db.match.delete`), wrapped in
   `translatePersistenceErrors` so a referential failure never leaks SQL. The
   participants and games are removed by the existing `onDelete: Cascade`; no raw
   SQL and no migration. Add the matching `remove` to the in-memory fake in
   `tests/unit/application/fake-repositories.ts` (delete the match and its
   participants/games from the maps).
2. **Service.** Add `regenerate(stageId, command): Promise<GroupFixtures>` to
   `GroupFixtureService`, sharing the existing validation and write with
   `generate` by extracting a private helper. The guards:
   - load the stage (`NotFoundError` when absent);
   - reject a non-GROUP stage with `BusinessRuleViolationError` (reuse `generate`'s
     rule);
   - reject a `COMPLETED` stage with `BusinessRuleViolationError` ("A completed
     stage's fixtures cannot be regenerated.");
   - reject a stage with **no** fixtures with `ConflictError` ("This stage has no
     fixtures to regenerate.") — regeneration replaces, it does not create;
   - validate the caller ordering exactly as `generate` does (≥2 entries, same
     category, active, unique);
   - in **one** `UnitOfWork.runInTransaction`: `remove` every existing match of the
     stage, then write the fresh round-robin (same `sequence`/`roundNumber`
     contract as `generate`) and return the new `GroupFixtures`.
3. **Route.** Add `app.post('/stages/:id/fixtures/regenerate', …)` in
   `apps/api/src/http/routes/stage-match.routes.ts`: validate `idParamSchema` and
   `generateGroupFixturesInputSchema`, delegate to `groupFixtures.regenerate(id, body)`,
   reply **200** with `data(fixtures)`. No Prisma import, no business logic in the
   handler.
4. **Web client + UI.** Add `regenerateFixtures(id, input, signal?)` to `StageApi`
   and its implementation (`client.post('/api/v1/stages/${id}/fixtures/regenerate', input, signal)`).
   In `StageDetailPage`, for a GROUP stage that already has matches, render a
   **"Regenerate fixtures"** control that opens a `ConfirmDialog` whose description
   states that the current matches and any recorded results will be discarded and
   replaced by a fresh round-robin; on confirm, call `regenerateFixtures` through
   the typed client and refetch the stage's matches (and standings). Reuse the
   existing entry-selection/ordering already provided by `GroupFixtureSetup` (or
   extract it) so the operator can supply the new ordering; do not add a second
   data-fetching framework or a raw `fetch`.
5. **Tests.** Unit (application over the in-memory ports), API integration
   (`app.inject`), a real-PostgreSQL database test for the replace/cascade
   boundary, a web component test, and an e2e spec — see the acceptance criteria.

## Acceptance criteria

1. `tests/unit/application/group-fixture-regeneration.service.test.ts` (new)
   passes over the in-memory ports: `GroupFixtureService.regenerate` replaces the
   stage's fixtures — the old match ids are gone and the stage now holds exactly
   `n(n-1)/2` matches with both slots filled for the new ordering; regenerating a
   stage with **no** fixtures is rejected with `ConflictError`; a `COMPLETED` stage
   is rejected with `BusinessRuleViolationError`; a non-GROUP stage is rejected with
   `BusinessRuleViolationError`; an unknown stage raises `NotFoundError`; fewer than
   two entries, a duplicated entry, a withdrawn entry and a foreign-category entry
   are rejected exactly as `generate` rejects them; the whole replace runs inside
   one `runInTransaction`.
2. `tests/unit/application/transaction-boundaries.test.ts` records exactly one
   `runInTransaction` for `regenerate` and asserts the existing `generate` boundary
   is unchanged.
3. `tests/integration/api/routes.test.ts` (or a sibling `group-fixtures.routes.test.ts`)
   asserts `POST /api/v1/stages/:id/fixtures/regenerate` returns **200** with the
   new fixtures and that `GET /api/v1/stages/:id/matches` afterwards returns only
   the new match set; returns **409** for a stage that has no fixtures; returns
   **422** for a `COMPLETED` stage; returns **404** for an unknown id; and returns
   **400** for an empty/one-element `entryIds` array. The existing
   `POST /api/v1/stages/:id/fixtures` cases still pass unchanged.
4. `tests/integration/database/group-fixture-regeneration-database.test.ts` (new)
   proves against real PostgreSQL that regeneration deletes the old matches and,
   through the `onDelete: Cascade` on `match_participants`/`match_games`, their
   participants and recorded games, and inserts the new round-robin in one
   transaction: after a regenerate the old match ids and their games are absent and
   the new set is present; a failure raised mid-regeneration leaves the original
   fixtures, participants and games intact.
5. `apps/web/src/pages/tournaments/stage-detail.test.tsx` (new) passes: the
   "Regenerate fixtures" control is rendered for a GROUP stage that already has
   matches and is absent for a GROUP stage with no matches and for a KNOCKOUT
   stage; confirming it calls `POST /api/v1/stages/:id/fixtures/regenerate` through
   the typed client (never the generate endpoint) and refetches the matches.
6. `e2e/group-fixture-regeneration.spec.ts` passes against the real
   UI/API/PostgreSQL: create a tournament, category and GROUP stage; generate a
   4-entry round-robin; record one result so a match is `COMPLETED` and the
   standings show points; regenerate with the same four entries in a different
   order; assert the match list is replaced (the previously completed match id is
   gone and no match is `COMPLETED`), the standings reset to zero played, and the
   new round-robin is present after a reload.
7. **No database migration, seed change or workflow change is introduced**: the
   diff adds nothing under `prisma/migrations/**` and does not touch
   `prisma/seed.ts` or `.github/workflows/ci.yml`. The existing
   `match_participants`/`match_games` `onDelete: Cascade` is reused, not altered.
8. The realtime catalogue is unchanged: `tests/unit/domain/realtime.test.ts` (its
   exact-list assertion) passes without edits, and no service publishes a new event
   type.
9. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and
   `npm run test:e2e` pass.

## Out of scope

- V1's before/after plan preservation (keeping results for pairings that survive a
  membership change); regeneration discards the whole fixture set.
- Regenerating a `COMPLETED` stage, and any change to `STAGE_TRANSITIONS` or the
  stage lifecycle.
- Resetting or regenerating a **knockout bracket** (gap G5) and the qualification
  or seeding behaviour; the round-robin algorithm itself is unchanged.
- Pair/group count caps (G12), the qualification default (G13), dropdown-based
  participant assignment (G14), export/import/reset (G9), team levels (G10) and the
  court availability/scheduler gaps (G7/G8).
- Any new realtime event type, a second data-fetching framework, or a new
  fixtures retrieval endpoint (retrieval keeps reusing `GET /stages/:id/matches`).
- Production data, credentials, or a hand merge.

## References

- `docs/tasks/task-5-parity-audit.md` (G15, §6 group fixture generation, §17)
- `docs/tasks/AI-004-stage-removal.md`, `docs/tasks/AI-005-court-removal.md`
  (the guarded-removal pattern and its transaction-boundary test)
- `AGENTS.md`
- `prisma/schema.prisma` (`Match`/`MatchParticipant`/`MatchGame` cascade,
  `TournamentStage.status`)
- `packages/domain/src/round-robin.ts`
- `packages/application/src/services/group-fixture.service.ts`
- `packages/application/src/repositories/index.ts`
- `packages/infrastructure/src/repositories.ts`
- `apps/api/src/http/routes/stage-match.routes.ts`
- `packages/validation/src/tournament/inputs.ts` (`generateGroupFixturesInputSchema`)
- `apps/web/src/api/services.ts` (`StageApi`)
- `apps/web/src/pages/tournaments/stage-detail.tsx`
- `apps/web/src/components/tournaments/group-fixture-setup.tsx`
- `tests/unit/application/group-fixture.service.test.ts`
- `e2e/group-fixtures.spec.ts`
