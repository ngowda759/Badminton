# AI-003 — Knockout result correction with bracket re-derivation (TASK-9, parity gap G6)

| Field          | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Task id        | `AI-003`                                                |
| Phase          | parity (G6 from the TASK-5 audit)                       |
| Status         | approved                                                |
| Human approval | not required — the brief is the implementation contract |
| Depends on     | AI-002                                                  |

## Summary

AI-002 added result correction for **group** matches and deliberately left a
**knockout** result immutable, because correcting one also requires re-deriving
the bracket: the winner that was propagated into the next round must be pulled
back out and the affected downstream matches must be reset, then the new winner
must be propagated. `docs/phase-6-knockout.md` §15/§17 records "no
result-correction workflow" and "a result-correction workflow" as the top future
extension point; the TASK-5 audit records the same as gap **G6** and notes V1's
`sourceA/sourceB` re-derivation exists precisely so a corrected earlier result
flows downstream.

This task completes G6 by making a **completed knockout match** correctable
through the existing `POST /api/v1/matches/:id/result/correction` endpoint. The
correction is a single atomic operation: it re-scores the match, then
**re-derives the bracket** — the immediate destination slot is re-filled with the
new winner, and any downstream match that had already been decided is reset
(winner and games cleared) because its participants changed. Group correction
(AI-002) is unchanged.

## Confirmed V1 behaviour

- `saveKnockoutScore` records a knockout result and `ensureKnockout` /
  `populatedPairing` / `reconcileBracket` re-derive the bracket from the stored
  feeder winners, so a corrected earlier result flows into the next round.
- `knockoutRulesLocked()` is derived (a knockout match exists), never a stored
  flag.
- A bracket is generated once; V1 refuses re-generation. This task does **not**
  add bracket re-generation or a reset-bracket route.

## Current state (what landed in AI-002)

- `packages/domain/src/correction.ts` — `isMatchCorrectable(match, stage)` is
  `true` only when `match.status === 'COMPLETED' && stage.type === 'GROUP'`.
- `MatchResultService.correctResult` rejects a knockout match with
  `BusinessRuleViolationError` (422).
- `apps/web/src/pages/tournaments/match-detail.tsx` renders `ResultCorrection`
  only for a completed non-knockout match; a completed knockout match shows the
  read-only note "The winner has advanced to the next knockout round."
- `MatchRepository.clearResult(id)` and `MatchGameRepository.deleteByMatch(id)`
  already exist; `MatchParticipantRepository.fillSlot(matchId, slot, entryId)` is
  create-only (never overwrites).
- `KnockoutProgressionService.progress` and `calculateNextBracketPosition`
  (`packages/domain/src/bracket.ts`) already own the winner→next-slot mapping.

## Intended change

1. **Domain (`packages/domain/src/correction.ts`).** Widen `isMatchCorrectable`
   so it is `true` for a `COMPLETED` match in **either** a `GROUP` or a
   `KNOCKOUT` stage, and `false` for any non-completed match. Keep the stage
   **type** as the discriminator (never `roundNumber`/`matchNumber`, which a group
   fixture also carries). Update the module doc comment. `MATCH_TRANSITIONS` stays
   `COMPLETED: []` and `MatchService.transitionStatus` must keep rejecting a bare
   `COMPLETED → IN_PROGRESS`.

2. **Repository port (`packages/application/src/repositories/index.ts`).** Add
   `MatchParticipantRepository.clearSlot(matchId: string, slot: number): Promise<void>`
   — removes the participant in one slot of one match, so a cascade can empty a
   destination slot before re-filling it with the new winner (or clear a stale
   winner with no replacement). Implement it in
   `packages/infrastructure/src/repositories.ts` (Prisma `deleteMany` on
   `{ matchId, slot }`) and in `tests/unit/application/fake-repositories.ts`. Do
   not add any other port.

3. **Application — new `packages/application/src/services/knockout-correction.service.ts`.**
   Add `KnockoutCorrectionService.reopen(client, stageId, correctedMatchId, newWinnerEntryId)`
   that re-derives the bracket on the **caller's transactional client** and
   returns whether the stage was reopened. The cascade is:

   - Let `stage` be the corrected match's stage (already validated `KNOCKOUT` by
     the caller). If `stage.drawSize` is `null` or the corrected match has no
     `roundNumber`/`matchNumber`, there is no bracket position → return `false`
     (nothing to re-derive; a standalone knockout match stays correctable).
   - `dest = calculateNextBracketPosition(roundNumber, matchNumber)`. If
     `dest.roundNumber > log2(drawSize)` the corrected match is the final → return
     `false` (no successor).
   - Find the destination match in the stage (one batched `matches.listByStage`,
     never a per-match query; a missing destination is a
     `BusinessRuleViolationError` — an inconsistent bracket).
   - If the destination slot already holds `newWinnerEntryId`, it is a no-op →
     return `false` (idempotent replay).
   - `matchParticipants.clearSlot(destMatch.id, dest.slot)` (only if the slot is
     occupied) then `matchParticipants.fillSlot(destMatch.id, dest.slot, newWinnerEntryId)`.
     Record a `KNOCKOUT_MATCH_POPULATED` outbox event for the destination.
   - If the destination match was `COMPLETED`, its stored result is now stale
     (its participants changed): `matchGames.deleteByMatch(destMatch.id)`,
     `matches.clearResult(destMatch.id)` (winner cleared, back to a playable
     state), and **recurse** into the destination's own destination, clearing the
     old winner's slot there (`clearSlot`), and resetting that match the same way
     if it too was `COMPLETED`. Continue until the final or an undecided match.
     Deeper slots are only **cleared** (no replacement — the reset match has no
     new winner yet).
   - After the cascade, if the stage row is `COMPLETED` but its final match is no
     longer `COMPLETED`, set the stage back to `ACTIVE` via
     `stages.updateStatus(stageId, 'ACTIVE')` and record a `STAGE_STATUS_CHANGED`
     outbox event, then return `true`. This is the one deliberate lifecycle
     exception: a derived stage reopens when a corrected result invalidates its
     final. `StageService.transitionStatus` keeps rejecting `COMPLETED → ACTIVE`.

   `MatchResultService.correctResult` becomes the orchestrator and keeps **one**
   `unitOfWork.runInTransaction`:
   1. load the match (`NotFoundError` → 404);
   2. load the stage (`NotFoundError` → 404) and reject with
      `BusinessRuleViolationError` (422) unless `isMatchCorrectable(match, stage)`;
   3. score the new games with the **same** rule selection `recordResult` uses
      (GROUP → `scoreGroupMatch`; KNOCKOUT → `scoreKnockoutMatch` with
      `resolveKnockoutRule`), an invalid score throwing the domain error (422);
   4. require the two participants;
   5. `matchGames.deleteByMatch` then `matchGames.createMany`;
   6. `matches.clearResult` then `matches.complete(matchId, newWinnerEntryId)`;
   7. for a `KNOCKOUT` stage call
      `knockoutCorrection.reopen(tx, stage.id, matchId, newWinnerEntryId)`;
   8. record `MATCH_RESULT_RECORDED` + `MATCH_COMPLETED` (exactly as `recordResult`
      / AI-002 do) and return the new `MatchResult`.

   Wire the new service in `apps/api/src/composition/api-services.ts`.

4. **API.** The existing `POST /api/v1/matches/:id/result/correction` route
   (`apps/api/src/http/routes/stage-match.routes.ts`) is reused unchanged; no new
   route and no new validation schema.

5. **Web.**
   - `apps/web/src/lib/correction.ts` (new) — `isResultCorrectable(status: MatchStatus): boolean`
     (`status === 'COMPLETED'`), mirroring the domain rule for immediate feedback
     (the API stays authoritative).
   - `apps/web/src/pages/tournaments/match-detail.tsx` — render the existing
     `ResultCorrection` control for a completed **knockout** match as well
     (reusing `MatchScoring` in correction mode with the round rule and the stored
     games pre-filled), and replace the "The winner has advanced…" note with copy
     explaining that a correction also re-derives the bracket. No duplicated
     scoring UI.

## Acceptance criteria

1. `tests/unit/domain/correction.test.ts` passes: `isMatchCorrectable` is `true`
   for a `COMPLETED` match in a `GROUP` stage and for a `COMPLETED` match in a
   `KNOCKOUT` stage (with and without a bracket position), and `false` for any
   non-`COMPLETED` match in either stage type.
2. `tests/unit/application/knockout-correction.service.test.ts` passes over the
   in-memory ports. For a 4-entry bracket: correcting the final re-derives nothing
   (`reopen` returns `false`); correcting semifinal 1 re-fills the final's slot 1
   with the new winner and, if the final was `COMPLETED`, resets it (status back
   to a playable state, winner cleared, games deleted) and reopens a `COMPLETED`
   stage to `ACTIVE`. For an 8-entry bracket: correcting quarterfinal 1 re-fills
   semifinal 1's slot 1 and, when semifinal 1 was `COMPLETED`, resets it and clears
   its old winner from the final's slot 1 (resetting the final too when it was
   `COMPLETED`); the resets cascade in ascending round order. A destination
   already holding the new winner is a no-op; a corrected match with no bracket
   position or no `drawSize` re-derives nothing; a missing destination match
   raises `BusinessRuleViolationError`.
3. `tests/unit/application/match-correction.service.test.ts` is extended so
   `correctResult` accepts a completed knockout match, returns the new result, and
   leaves the old winner absent from the next round's slot (the destination now
   holds the new winner). The existing group cases (replaced games/winner,
   standings, illegal score, unknown id, mid-write rollback) are updated only
   where the new knockout support changes the expectation, and still pass.
4. `tests/unit/application/transaction-boundaries.test.ts` records exactly one
   `runInTransaction` for a knockout `correctResult` (the corrected result and the
   whole cascade are one transaction) and asserts `recordResult` is unchanged.
5. `tests/integration/api/routes.test.ts` asserts
   `POST /api/v1/matches/:id/result/correction` returns `201` with the new result
   for a completed knockout match (a 4-entry bracket, correcting a semifinal so the
   final's slot 1 changes and the final is reset), `422` for a non-completed match,
   `404` for an unknown id and `400` for an empty `games` array; the existing
   group-correction cases still pass unchanged.
6. `apps/web/src/pages/tournaments/match-detail.test.tsx` passes: the "Correct
   result" control is rendered for a completed knockout match and submitting it
   calls the correction endpoint (never the record endpoint); the group case still
   passes.
7. `e2e/result-correction.spec.ts` passes against the real UI/API/PostgreSQL:
   generate a 4-entry bracket, play both semifinals, play the final; correct a
   semifinal so the other competitor wins, assert the semifinal stays `COMPLETED`
   with the new winner, the final's slot 1 holds the new winner and the final is no
   longer `COMPLETED` (its stale result was reset); the existing group-correction
   assertions still pass and the read-only knockout assertion is replaced by the
   new correction behaviour.
8. No database migration, seed change or workflow change is introduced — the
   cascade reuses the existing `matches`, `match_participants` and `match_games`
   tables (the diff adds nothing under `prisma/migrations/**` and does not touch
   `prisma/seed.ts` or `.github/workflows/ci.yml`).
9. The realtime catalogue is unchanged: `tests/unit/domain/realtime.test.ts` (its
   exact-list assertion) passes without edits; the cascade reuses
   `MATCH_RESULT_RECORDED`, `MATCH_COMPLETED`, `KNOCKOUT_MATCH_POPULATED` and
   `STAGE_STATUS_CHANGED`.
10. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and
    `npm run test:e2e` pass.

## Out of scope

- A "reset bracket" / re-generate bracket route, or changing bracket size or
  first-round pairings after generation (the bracket stays generated-once).
- An audit trail / correction history (V1 has none).
- Any new realtime event type, any second data-fetching framework, any change to
  `recordResult`, `MATCH_TRANSITIONS` or `MatchService.transitionStatus`.
- Export/import/reset of a whole tournament, court/stage deletion, scheduler
  parity, team levels and the other TASK-5 gaps (G7–G16).
- Production data, credentials, or a hand merge.

## Validation expected

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Notes

- **One transaction.** The corrected result and the whole cascade (re-fill +
  reset + re-derive) commit or roll back together, so the bracket is never left
  half-corrected. Do not split the cascade into a second transaction and do not
  publish to SSE directly — the outbox rows are written on the transactional
  client and the dispatcher forwards committed rows only.
- **Reuse the existing rules.** Derive the destination from
  `calculateNextBracketPosition` and the scoring rule from
  `resolveKnockoutRule` / `knockoutMatchRule`, exactly as `recordResult` and
  `KnockoutProgressionService` do. Do not add a second bracket-maths
  implementation or a second scoring path.
- **Idempotency.** A destination already holding the new winner is skipped
  (mirroring `KnockoutProgressionService.progress`), so replaying a correction
  never duplicates a participant or an event. `fillSlot` stays create-only, so a
  taken slot must be cleared first.
- **Realtime notification.** The corrected match's `MATCH_RESULT_RECORDED` +
  `MATCH_COMPLETED` and the destination's `KNOCKOUT_MATCH_POPULATED` are the
  events; the tournament-scoped refresh bus refetches every registered query on
  any event, so a reset downstream match needs no dedicated event type. Do not
  invent one.
- **Stage reopen is the single lifecycle exception.** `stages.updateStatus` may
  write `ACTIVE` over `COMPLETED` only from the cascade, to keep the derived
  stage consistent with a reset final; the generic
  `StageService.transitionStatus` path must not gain that transition. Do not add
  a stored completion flag — completion stays derived on read.
- **Group path unchanged.** Widening `isMatchCorrectable` must not change group
  behaviour or the `COMPLETED → IN_PROGRESS` transition table.
- `localhost` and `127.0.0.1` are distinct origins; keep both in `CORS_ORIGINS`.
