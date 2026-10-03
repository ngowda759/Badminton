# AI-004 — Guarded removal of an empty stage (TASK-10, parity gap G11)

| Field          | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Task id        | `AI-004`                                                |
| Phase          | parity (G11 from the TASK-5 audit)                      |
| Status         | approved                                                |
| Human approval | not required — the brief is the implementation contract |
| Depends on     | AI-003                                                  |

## Summary

The TASK-5 parity audit records gap **G11** as a medium-severity operator-workflow
gap: "Cannot remove a group/stage or a court". V1 lets an operator call
`removeGroup()` (`index.html:3412`), which deletes an **empty** group and refuses
a non-empty group or the last group; V2 has no delete route or service for a
stage at all (`apps/api/src/http/routes/stage-match.routes.ts` exposes only
get/post/patch/transition). A mis-created stage is therefore permanent.

This task closes the stage half of G11 with the smallest coherent change: a
**guarded removal of an empty stage** through `DELETE /api/v1/stages/:id`,
mirroring V1's empty-group rule. A stage may be removed only when it has **no
matches**; the removal is one atomic operation that also deletes the stage's
outbox-independent state cleanly and notifies connected devices. Removing a
non-empty stage is refused (409) — a bracket or a generated round-robin must be
torn down through the match lifecycle first, exactly as V1 refuses a non-empty
group. The court half of G11 (a court delete) is deliberately out of scope.

## Confirmed V1 behaviour

- `removeGroup()` (`index.html:3412`) deletes a group only when it is empty;
  a non-empty group and the last remaining group are both refused.
- A structural pair move that would empty a group is a separate, confirmed flow;
  group removal itself is not a results-destroying operation.
- V1 never deletes a group that still holds pairings, because that would silently
  discard fixtures.

## Repository state after AI-003

- `TournamentStageService` (`packages/application/src/services/stage.service.ts`)
  owns create/update/transitionStatus/getById/listByCategory. There is **no**
  `remove` method and no `DELETE` stage route.
- `TournamentStageRepository`
  (`packages/application/src/repositories/index.ts`) has create/findById/
  listByCategory/listByTournament/update/updateStatus and **no** `delete`.
- `MatchRepository` already exposes `listByStage(stageId)` and
  `listByTournament(tournamentId)`, so the emptiness guard needs no new read.
- `matches.stageId` is `onDelete: Restrict` (`prisma/schema.prisma`), so the
  database independently refuses to delete a stage that still has matches. The
  service pre-check exists only to return a friendly `ConflictError`; the
  constraint remains the final boundary.
- The realtime catalogue (`packages/domain/src/realtime.ts`,
  `packages/application/src/realtime/event-types.ts`) is an exact, tested list.
  This task adds **no** new event type; it reuses `STAGE_STATUS_CHANGED` only if
  a lifecycle change is involved, and otherwise emits nothing (a removed stage
  cannot carry a read-model event and its `STAGE` aggregate no longer exists).
  Because the stage list is what a connected client refetches, the removal is
  surfaced by the client's own tournament-scoped refetch, not by a new event.
- `apps/web/src/api/services.ts` (`StageApi`) and
  `apps/web/src/pages/tournaments/stages.tsx` /
  `stage-detail.tsx` are where the operator control and the typed client method
  belong; components delegate to `lib/`/hooks, never to `fetch` directly.

## Implementation

1. **Repository port + adapter.** Add `delete(id: string): Promise<void>` to
   `TournamentStageRepository` and implement it in
   `packages/infrastructure/src/repositories.ts` (`db.tournamentStage.delete`),
   wrapped in `translatePersistenceErrors`. A `P2003`/`P2014` foreign-key
   failure is already translated to a `ConflictError`; do not leak SQL.
2. **Service guard.** Add `remove(id: string): Promise<void>` to
   `TournamentStageService`:
   - load the stage (`NotFoundError` when absent);
   - reject when the stage has any matches via `client.matches.listByStage(id)`
     with a `ConflictError` ("A stage with matches cannot be removed."), so a
     generated round-robin or a knockout bracket is never silently discarded;
   - reject when it is the category's **last** stage with a
     `BusinessRuleViolationError`, mirroring V1's "refuses the last group";
   - delete through the repository.
   The guard and the delete run in one `UnitOfWork.runInTransaction` only if the
   operation must be atomic; a single delete plus a read pre-check does **not**
   require a transaction (the DB `Restrict` is the concurrency boundary), so
   follow the existing `TeamService.removeMember` shape (a transaction is opened
   there only because it reads then deletes; match that shape and record the
   boundary in `tests/unit/application/transaction-boundaries.test.ts`).
3. **Route.** Add `app.delete('/stages/:id', …)` in
   `apps/api/src/http/routes/stage-match.routes.ts`: validate `idParamSchema`,
   delegate to `stages.remove(id)`, reply `204`. No Prisma import, no business
   logic in the handler.
4. **Web client + UI.** Add `remove(id, signal?)` to `StageApi` and its
   implementation (`client.delete('/api/v1/stages/${id}')`), then add a
   "Remove stage" control on the stages list (`stages.tsx`) and/or the stage
   detail page that is **only offered for an empty stage** (no matches) and
   confirms before deleting, then refetches the list. Reuse the existing
   confirm-dialog pattern already used for terminal transitions; do not add a new
   data-fetching framework.
5. **Tests.** Unit (domain/application over the in-memory ports), API
   integration (`app.inject`), a real-PostgreSQL database test for the
   `Restrict` boundary, a web component test, and an e2e spec — see the
   acceptance criteria.

## Acceptance criteria

1. `tests/unit/application/stage-removal.service.test.ts` passes over the
   in-memory ports: `remove` deletes an **empty** stage (it is gone from
   `listByCategory`); a stage with a match is rejected with `ConflictError` and
   is not deleted; the **last** stage of a category is rejected with
   `BusinessRuleViolationError`; an unknown id raises `NotFoundError`.
2. `tests/unit/application/transaction-boundaries.test.ts` is updated to record
   the boundary for `remove` and to assert that the existing
   create/update/transition boundaries are unchanged.
3. `tests/integration/api/routes.test.ts` (or a sibling API spec) asserts
   `DELETE /api/v1/stages/:id` returns **204** and the stage no longer appears in
   `GET /api/v1/categories/:categoryId/stages`; returns **409** for a stage that
   has a match; returns **400/422** for the last stage of a category; and returns
   **404** for an unknown id. The existing stage cases still pass unchanged.
4. `tests/integration/database/*-database.test.ts` (a new or extended spec)
   proves against real PostgreSQL that the `matches.stageId` `onDelete: Restrict`
   constraint is the final boundary: a direct delete of a stage that still has a
   match fails and is translated to a `ConflictError`, never a raw SQL error.
5. `apps/web/src/pages/tournaments/stages.test.tsx` (new) or the existing
   stage-detail test passes: the "Remove stage" control is rendered for an empty
   stage and is absent (or disabled) for a stage that has matches; confirming
   calls `DELETE /api/v1/stages/:id` through the typed client and refetches the
   list.
6. `e2e/stage-removal.spec.ts` passes against the real UI/API/PostgreSQL: create a
   tournament, category and two stages; remove the empty stage and assert it
   disappears from the list and survives a reload; generate group fixtures for the
   other stage and assert the removal control is not offered / the delete is
   refused.
7. **No database migration, seed change or workflow change is introduced**: the
   diff adds nothing under `prisma/migrations/**` and does not touch
   `prisma/seed.ts` or `.github/workflows/ci.yml`. The existing
   `onDelete: Restrict` FK is reused, not altered.
8. The realtime catalogue is unchanged: `tests/unit/domain/realtime.test.ts` (its
   exact-list assertion) passes without edits, and no service publishes a new
   event type.
9. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and
   `npm run test:e2e` pass.

## Out of scope

- Removing a **court** (the other half of G11) and any court availability-window
  or scheduler work (G7/G8).
- Removing or regenerating a stage that has matches, or a "clear results" /
  "reset bracket" flow (G5/G9).
- Cascading deletes of matches, participants, games or entries; the `Restrict`
  FK stays authoritative and a non-empty stage is always refused.
- Any new realtime event type, a second data-fetching framework, or a change to
  `MATCH_TRANSITIONS` / `STAGE_TRANSITIONS` / `MatchService.transitionStatus`.
- The remaining TASK-5 gaps (G9 export/import/reset, G10 team levels, G12 caps,
  G13 default, G14 dropdown participant assignment, G15 regenerate flow, G16).
- Production data, credentials, or a hand merge.

## References

- `docs/tasks/task-5-parity-audit.md` (G11, §5 group configuration, §12 courts)
- `AGENTS.md`
- `docs/phase-2-domain-design.md`
- `prisma/schema.prisma` (`Match.stageId` `onDelete: Restrict`)
- `packages/application/src/services/stage.service.ts`
- `packages/application/src/services/team.service.ts` (`removeMember` shape)
- `packages/application/src/repositories/index.ts`
- `packages/infrastructure/src/repositories.ts`, `packages/infrastructure/src/errors.ts`
- `apps/api/src/http/routes/stage-match.routes.ts`
- `apps/web/src/api/services.ts`
- `apps/web/src/pages/tournaments/stages.tsx`, `stage-detail.tsx`
