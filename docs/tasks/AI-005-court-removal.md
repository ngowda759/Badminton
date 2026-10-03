# AI-005 — Guarded removal of a court (TASK-11, parity gap G11)

| Field          | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Task id        | `AI-005`                                                |
| Phase          | parity (G11 from the TASK-5 audit)                      |
| Status         | approved                                                |
| Human approval | not required — the brief is the implementation contract |
| Depends on     | AI-004                                                  |

## Summary

The TASK-5 parity audit records gap **G11** as a medium-severity operator-workflow
gap: "Cannot remove a group/stage or a court". AI-004 closed the **stage** half
(`DELETE /api/v1/stages/:id`, guarded removal of an empty stage). The **court**
half is still open: V2 has no delete route or service for a court at all, so a
mis-created court is permanent and can only be deactivated.

V1's `removeCourt()` (`index.html:1556`) refuses an unknown court, refuses to drop
the tournament's **last** court (`MIN_COURTS = 1`) and refuses a court that still
has a match **in progress** (`matchOnCourt`, `index.html:2219`). This task closes
the court half of G11 with the smallest coherent change: a **guarded removal of a
court** through `DELETE /api/v1/courts/:id`, mirroring both V1 and the AI-004 stage
pattern. A court may be removed only when **no match currently occupies it**; the
tournament's last court is never removed; the `matches.courtId` `onDelete: Restrict`
constraint is the final boundary.

## Confirmed V1 behaviour

- `removeCourt(id)` (`index.html:1556`) deletes a court only when it is not the
  tournament's last court and no match is in progress on it.
- `validateCourts(list)` (`index.html:1445`) enforces `MIN_COURTS = 1` … `MAX_COURTS = 8`.
- `matchOnCourt(courtId)` (`index.html:2219`) is true only for a match whose status
  is `in_progress` on that court — the check V1 uses to refuse removal. V2 has no
  "court that no longer exists" notion, so a scheduled-but-not-started match also
  occupies a court and blocks removal; this is the stricter, V2-consistent reading
  (a scheduled match references the court it will be played on).

## Repository state after AI-004

- `CourtService` (`packages/application/src/services/court.service.ts`) owns
  create/update/transitionStatus/getById/listByTournament. There is **no** `remove`
  method and no `DELETE` court route.
- `CourtRepository` (`packages/application/src/repositories/index.ts`) has
  create/findById/listByTournament/update/updateStatus and **no** `delete`.
- `MatchRepository` already exposes `listByCourt(courtId)`, implemented in the
  Prisma adapter (`packages/infrastructure/src/repositories.ts`) and the in-memory
  fake (`tests/unit/application/fake-repositories.ts`), so the occupancy guard needs
  **no** new read and **no** new endpoint. (It is currently unused by any service.)
- `matches.courtId` is `onDelete: Restrict` (`prisma/schema.prisma:245`), so the
  database independently refuses to delete a court that still has matches. The
  service pre-check exists only to return a friendly `ConflictError`; the constraint
  remains the final boundary.
- The realtime catalogue (`packages/domain/src/realtime.ts`,
  `packages/application/src/realtime/event-types.ts`) is an exact, tested list. This
  task adds **no** new event type; a removed court emits nothing (its `COURT`
  aggregate no longer exists), and the court list is surfaced by the client's own
  tournament-scoped refetch.
- `apps/web/src/api/services.ts` (`CourtApi`) and
  `apps/web/src/pages/tournaments/courts-manage.tsx` are where the operator control
  and the typed client method belong; components delegate to `lib/`/hooks, never to
  `fetch` directly. The page already reads the court list with `useApiQuery` and
  refetches it with `useTournamentRefresh`.

## Implementation

1. **Repository port + adapter.** Add `delete(id: string): Promise<void>` to
   `CourtRepository` and implement it in `packages/infrastructure/src/repositories.ts`
   (`db.court.delete`), wrapped in `translatePersistenceErrors`. A `P2003`/`P2014`
   foreign-key failure is already translated to a `ConflictError`; do not leak SQL.
   The in-memory fake gains the matching `delete` (mutating its `courts` map).
2. **Service guard.** Add `remove(id: string): Promise<void>` to `CourtService`:
   - load the court (`NotFoundError` when absent);
   - reject when any match occupies it via `client.matches.listByCourt(id)` with a
     `ConflictError` ("A court that still has a match cannot be removed."), so a
     scheduled, in-progress or completed match is never orphaned;
   - reject when it is the tournament's **last** court with a
     `BusinessRuleViolationError`, mirroring V1's `MIN_COURTS = 1`;
   - delete through the repository.
   The guard and the delete run in **no** transaction: the DB `Restrict` is the
   concurrency boundary, and the AI-004 stage removal established the same shape
   (a read pre-check plus a single delete). Record the boundary in
   `tests/unit/application/transaction-boundaries.test.ts`.
3. **Route.** Add `app.delete('/courts/:id', …)` in
   `apps/api/src/http/routes/court.routes.ts`: validate `idParamSchema`, delegate to
   `courts.remove(id)`, reply `204`. No Prisma import, no business logic in the handler.
4. **Web client + UI.** Add `remove(id, signal?)` to `CourtApi` and its
   implementation (`client.delete('/api/v1/courts/${id}')`), then add a "Remove"
   control to `CourtRowActions` on the courts page that is **only offered for a
   court with no matches** (read lazily through `api.matches.listByStage`-style
   loading — use the existing dashboard court `busy` flag or a lazy match read;
   whichever keeps the page's existing data-fetching) and **disabled for the
   tournament's only court**, confirms before deleting, then refetches the list.
   Reuse the existing `ConfirmDialog` pattern already used for the stage removal
   control; do not add a new data-fetching framework.
5. **Tests.** Unit (application over the in-memory ports), API integration
   (`app.inject`), a real-PostgreSQL database test for the `Restrict` boundary, a
   web component test, and an e2e spec — see the acceptance criteria.

## Acceptance criteria

1. `tests/unit/application/court-removal.service.test.ts` (new) passes over the
   in-memory ports: `CourtService.remove` deletes a court that has no matches (it is
   gone from `listByTournament`); a court that has any match is rejected with
   `ConflictError` and is not deleted; the tournament's **last** court is rejected
   with `BusinessRuleViolationError`; an unknown id raises `NotFoundError`; a
   deactivated court with no matches is removable.
2. `tests/unit/application/transaction-boundaries.test.ts` records that
   `CourtService.remove` opens **no** transaction and asserts the existing
   create/update/transition boundaries are unchanged.
3. `tests/integration/api/court-scheduling.routes.test.ts` asserts
   `DELETE /api/v1/courts/:id` returns **204** for a court with no matches and the
   court no longer appears in `GET /api/v1/tournaments/:tournamentId/courts`;
   returns **409** for a court that has a match; returns **422** for the tournament's
   last court; and returns **404** for an unknown id. The existing court cases still
   pass unchanged.
4. `tests/integration/database/court-scheduling-database.test.ts` (extended) proves
   against real PostgreSQL that the `matches.courtId` `onDelete: Restrict` constraint
   is the final boundary: a direct delete of a court that still has a match fails and
   is translated to a `ConflictError`, never a raw SQL error, and the raw driver
   message (constraint name / SQL) does not leak.
5. `apps/web/src/pages/tournaments/courts.test.tsx` (new) passes: a Remove control
   is rendered and enabled for a court with no matches; it is disabled for a court
   that already has a match; confirming it calls `DELETE /api/v1/courts/:id` through
   the typed client and refetches the list; the control is also disabled when it is
   the tournament's only court.
6. `e2e/court-removal.spec.ts` passes against the real UI/API/PostgreSQL: create a
   tournament with two courts; remove the empty court and assert it disappears from
   the courts page and survives a reload; schedule a match on the remaining court and
   assert its removal control is disabled and `DELETE /api/v1/courts/:id` is refused
   with a conflict; the last-court refusal is exercised at the API level.
7. **No database migration, seed change or workflow change is introduced**: the diff
   adds nothing under `prisma/migrations/**` and does not touch `prisma/seed.ts` or
   `.github/workflows/ci.yml`. The existing `matches.courtId` `onDelete: Restrict` FK
   is reused, not altered.
8. The realtime catalogue is unchanged: `tests/unit/domain/realtime.test.ts` (its
   exact-list assertion) passes without edits, and no service publishes a new event
   type.
9. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and
   `npm run test:e2e` pass.

## Out of scope

- Removing a court that still has **any** match, and cascading deletes of matches,
  participants or games; the `Restrict` FK stays authoritative and a non-empty court
  is always refused.
- Court availability windows / start-end times, the out-of-hours override setting and
  the rolling scheduler (G7/G8), and the 1–8 court count cap (G12).
- Any change to `CourtService.create`/`update`/`transitionStatus`, `COURT_TRANSITIONS`,
  or the existing scheduling endpoints.
- The remaining TASK-5 gaps (G9 export/import/reset, G10 team levels, G12 caps, G13
  default, G14 dropdown participant assignment, G15 regenerate flow, G16).
- Any new realtime event type, a second data-fetching framework, or a new GET
  matches-by-court endpoint.
- Production data, credentials, or a hand merge.

## References

- `docs/tasks/task-5-parity-audit.md` (G11, §12 courts, §5 group configuration)
- `docs/tasks/AI-004-stage-removal.md` (the stage half of G11, the pattern to mirror)
- `AGENTS.md`
- `prisma/schema.prisma` (`Match.courtId` `onDelete: Restrict`)
- `packages/application/src/services/court.service.ts`
- `packages/application/src/services/stage.service.ts` (`remove` shape)
- `packages/application/src/repositories/index.ts`
- `packages/infrastructure/src/repositories.ts`, `packages/infrastructure/src/errors.ts`
- `apps/api/src/http/routes/court.routes.ts`
- `apps/web/src/api/services.ts`
- `apps/web/src/pages/tournaments/courts-manage.tsx`
- `tests/integration/api/court-scheduling.routes.test.ts`
- `tests/integration/database/court-scheduling-database.test.ts`
