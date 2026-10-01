# AI-002 — Match result correction with downstream propagation (TASK-8, parity gap G6)

| Field          | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Task id        | `AI-002`                                                |
| Phase          | parity (G6 from the TASK-5 audit)                       |
| Status         | approved                                                |
| Human approval | not required — the brief is the implementation contract |
| Depends on     | AI-001                                                  |

## Summary

A recorded result is currently **immutable**: `MatchResultService.recordResult`
rejects a second completion (`ConflictError`) and there is no way to reset a
match. V1 (the functional source of truth) lets an operator re-enter a score
(`saveGroupScore`) and reset a match (`resetMatch`); the TASK-5 audit records the
missing correction workflow as **gap G6** and as the top remaining parity item
(`docs/tasks/task-5-parity-audit.md` §7/§8/§16). This task adds a **guarded
result-correction workflow for GROUP matches**: a completed group match can be
reset to `IN_PROGRESS` and re-scored in one atomic operation, so a mistyped score
can be fixed without touching the database by hand. Group standings — and the
qualification that reads them — are derived from the stored games, so correcting
a result automatically corrects both.

The scope is deliberately GROUP-only. Correcting a **knockout** result also
requires re-deriving the bracket (clearing the winner from the next round's slot
and un-completing every downstream match), which the audit calls "the largest
single workflow addition"; that bracket re-derivation is a separate follow-up and
is out of scope here. A knockout match therefore stays immutable and its
correction control is not offered.

## References

- `AGENTS.md` — layering, strict TypeScript and realtime invariants
- `docs/tasks/task-5-parity-audit.md` — gap G6, V1 evidence
  (`saveGroupScore` index.html:2150, `resetMatch` index.html:2297)
- `docs/phase-5-group-scoring.md` — the "COMPLETED results are immutable"
  statement this task supersedes, and its §16 future work (result correction)
- `docs/phase-6-knockout.md` — the knockout immutability this task preserves
- `packages/domain/src/scoring.ts`, `packages/domain/src/lifecycle-tables.ts`,
  `packages/domain/src/bracket.ts` (`isBracketFinalMatch`)
- `packages/application/src/services/match-result.service.ts`,
  `packages/application/src/repositories/index.ts`
- `packages/infrastructure/src/repositories.ts`
- `apps/api/src/http/routes/stage-match.routes.ts`
- `apps/web/src/pages/tournaments/match-detail.tsx`,
  `apps/web/src/components/tournaments/match-scoring.tsx`,
  `apps/web/src/api/services.ts`

## Confirmed V1 behaviour

- `saveGroupScore` re-enters a group result; a correction is allowed only while
  no bracket has been generated, and once a bracket exists a correction must go
  through the explicit ↺ Reset first.
- `resetMatch` clears the stored result and returns the match to an editable
  state so the corrected score can be entered.
- Standings are recomputed from the stored results, so a corrected group score
  immediately changes points, point difference and qualification.

## Intended change

1. **Domain (`packages/domain/src/correction.ts`, new).** A pure predicate
   `isMatchCorrectable(match: Match): boolean` that is `true` exactly when the
   match is `COMPLETED` **and** it is a group match (no bracket position:
   `roundNumber === null && matchNumber === null`). This mirrors the existing
   derived-structure idiom (`isBracketFinalMatch`) — a knockout match is
   identified by its bracket position, never by a stored flag. Export it from
   `packages/domain/src/index.ts`.

2. **Repository ports (`packages/application/src/repositories/index.ts`).**
   - `MatchRepository.clearResult(id): Promise<Match>` — clears `winnerEntryId`
     and sets `status: 'IN_PROGRESS'` in one write.
   - `MatchGameRepository.deleteByMatch(matchId): Promise<void>` — removes the
     stored games of one match so the corrected set replaces them.

   Implement both in `packages/infrastructure/src/repositories.ts` and in the
   in-memory fakes (`tests/unit/application/fake-repositories.ts`).

3. **Application (`packages/application/src/services/match-result.service.ts`).**
   Add `correctResult(matchId, command: RecordMatchResultCommand): Promise<MatchResult>`
   to `MatchResultService`. It runs in **one** `UnitOfWork.runInTransaction`:
   1. load the match (`NotFoundError` → 404 when absent);
   2. reject with `BusinessRuleViolationError` (422) unless
      `isMatchCorrectable(match)`;
   3. load the stage and score the new games with the **same** rule selection
      `recordResult` uses (group → `scoreGroupMatch`); an invalid score throws
      the domain error (422);
   4. `matchGames.deleteByMatch` then `matchGames.createMany` with the new games;
   5. `matches.clearResult` (winner cleared, status back to `IN_PROGRESS`);
   6. record the `MATCH_RESULT_RECORDED` and `MATCH_COMPLETED` outbox events
      (the authoritative result changed), exactly as `recordResult` does;
   7. return the new `MatchResult`.

   It must **not** call knockout progression (group-only) and must **not**
   change `recordResult` or the generic transition path. `MATCH_TRANSITIONS` and
   `MatchService.transitionStatus` must keep rejecting a bare
   `COMPLETED → IN_PROGRESS`: a status flip that left the games and winner behind
   would be inconsistent, so correction is a dedicated operation guarded by
   `isMatchCorrectable`, not a new lifecycle transition.

4. **API (`apps/api/src/http/routes/stage-match.routes.ts`).** Add
   `POST /api/v1/matches/:id/result/correction`, validating the existing
   `recordMatchResultInputSchema`, delegating to `matchResults.correctResult` and
   returning `201` with the `MatchResultDto`. No new validation schema is needed.

5. **Web.**
   - `apps/web/src/api/services.ts`: add
     `correctResult(matchId, input, signal): Promise<MatchResultDto>` to
     `MatchApi`, calling the new endpoint.
   - `apps/web/src/components/tournaments/match-scoring.tsx`: accept optional
     `initialGames` and a submit-label override so the same form can be reused
     for correction (no duplicated scoring UI).
   - `apps/web/src/pages/tournaments/match-detail.tsx`: for a `COMPLETED`
     **group** match, show a "Correct result" action that reveals the scoring
     form (pre-filled from the stored result), requires the existing
     `ConfirmDialog`, submits via `correctResult` and refetches the match,
     participants, result and standings. For a completed **knockout** match the
     result stays read-only with an explanatory note (no control).

## Acceptance criteria

1. `tests/unit/domain/correction.test.ts` passes: `isMatchCorrectable` is `true`
   for a `COMPLETED` group match (`roundNumber`/`matchNumber` `null`) and `false`
   for a completed knockout match (non-null bracket position) and for any
   non-`COMPLETED` match.
2. `tests/unit/application/match-correction.service.test.ts` passes:
   - correcting a completed group match replaces the stored games, recomputes the
     winner and returns the new `MatchResult`;
   - the corrected score is reflected by `StandingsService.getStageStandings`
     (points and point difference match the new result);
   - a knockout match (with a bracket position) is rejected with
     `BusinessRuleViolationError`; a non-completed match is rejected the same way;
     an unknown match id raises `NotFoundError`; an illegal group score (e.g.
     31-29) is rejected;
   - a failure mid-correction leaves the original result, games and winner
     unchanged (the transaction rolls back).
3. `tests/unit/application/transaction-boundaries.test.ts` records exactly one
   `runInTransaction` for `correctResult` and asserts `recordResult` is
   unchanged.
4. `tests/integration/api/routes.test.ts` (or a sibling API spec) asserts:
   `POST /api/v1/matches/:id/result/correction` returns `201` with the new result
   for a completed group match; `422` for a knockout match; `404` for an unknown
   id; `400` for an empty `games` array.
5. `apps/web/src/pages/tournaments/match-detail.test.tsx` passes: the
   "Correct result" control is rendered for a completed group match and is
   **absent** for a completed knockout match; submitting the correction calls the
   correction endpoint.
6. `e2e/result-correction.spec.ts` passes against the real UI/API/PostgreSQL:
   score a group match 21-10, correct it to 21-19, assert the match stays
   `COMPLETED` and the group standings show the corrected points; assert a
   completed knockout match exposes no correction control.
7. No database migration, seed change or workflow change is introduced — the
   correction uses the existing `matches`, `match_participants` and
   `match_games` tables (the diff must not add anything under
   `prisma/migrations/**` or touch `prisma/seed.ts` / `.github/workflows/ci.yml`).
8. The realtime catalogue is unchanged: `tests/unit/domain/realtime.test.ts`
   (its exact-list assertion) passes without edits.
9. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and
   `npm run test:e2e` pass.

## Out of scope

- Correcting a **knockout** result and re-deriving the bracket (clearing the
  winner from the next round and un-completing downstream matches) — a separate
  follow-up.
- An audit trail / correction history (V1 has none; the audit lists it as future
  work only).
- Export/import/reset of a whole tournament, court/stage deletion, scheduler
  parity, team levels and the other TASK-5 gaps (G7–G16).
- Any new realtime event type, any second data-fetching framework, any change to
  `recordResult`, `MATCH_TRANSITIONS` or `MatchService.transitionStatus`.
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

- Reuse the existing scoring path: the correction must select the format from the
  **stage type inside the transaction** exactly as `recordResult` does, so the
  two can never disagree. Do not add a second scoring implementation.
- Realtime stays a notification channel: the correction writes the business rows
  and its `MATCH_RESULT_RECORDED` + `MATCH_COMPLETED` outbox rows in the **same**
  `UnitOfWork` transaction and never publishes to SSE directly. No new event type
  is added, so the exact-list assertion in `tests/unit/domain/realtime.test.ts`
  stays valid.
- A correction can change who qualifies from a group; bracket generation already
  refuses while any feeder group match is incomplete, and after a committed
  correction the match is `COMPLETED` again, so no stale-standings path is
  introduced. Do not change the qualification or bracket-generation rules.
- The web correction form must reuse `MatchScoring` (extended with an optional
  initial value and submit label) rather than duplicating the score-entry UI, and
  must go through the existing `ConfirmDialog` for the destructive reset.
- `localhost` and `127.0.0.1` are distinct origins; keep both in `CORS_ORIGINS`.
