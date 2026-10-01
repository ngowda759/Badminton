# TASK-7 — Knockout Scoring and Configuration V1 Parity

| Field          | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Task id        | `TASK-7`                                                |
| Phase          | parity (G4 from the TASK-5 audit)                       |
| Status         | implemented                                             |
| Human approval | not required — the brief is the implementation contract |
| Depends on     | TASK-6 (group-stage scoring and standings parity)       |

## Summary

Bring V2 knockout-stage scoring and configuration into functional parity with the
V1 `Tournament` application. V1 is the functional source of truth. The confirmed
V1 behaviour (read from `index.html` and `tests/core.test.js`) is recorded below
and implemented in `@badminton/domain` plus the application/API/web layers.

## Confirmed V1 behaviour

### Per-round scoring configuration

- `KNOCKOUT_ROUNDS` is a round catalogue keyed `r32`, `r16`, `qf`, `sf`, `final`.
- `DEFAULT_KNOCKOUT_RULES` seeds every round with `{ format: 'best_of_3',
pointsPerGame: KNOCKOUT_TARGET[key] }`, where the targets are
  **R32 11, R16 11, QF 11, SF 15, Final 21**.
- `KNOCKOUT_FORMAT_BEST_OF_3 = 'best_of_3'` (first to two games) and
  `KNOCKOUT_FORMAT_SINGLE_GAME = 'single_game'` ("Straight set", one game).
- `MIN_POINTS_PER_GAME = 1`, `MAX_POINTS_PER_GAME = 99`.
- `setKnockoutRule(stage, rule)` rejects an unknown round, an invalid rule and a
  locked edit; `validateKnockoutRule` requires a known format and an integer
  target in `[1, 99]`. `normalizeKnockoutRules` fills missing rounds from the
  defaults and drops malformed entries; `knockoutRuleFor` falls back to the
  default when a stored rule is malformed.

### Per-round score validation (this is the load-bearing difference)

- A **group** game is validated by `validateGroupScore`: target 21, margin ≥ 2,
  and a **30-point cap** (30-29 wins, 31-29 is illegal).
- A **knockout** game is validated by `validateSetScore(a, b, target)` against
  the **round's target**, margin ≥ 2, with **no ceiling** (30-29 is illegal
  because the margin is 1; 31-29 is legal).
- A **best-of-3** match needs two games (2-0 or 2-1); a third game after 2-0 is
  rejected, and a 1-1 result with no decider is rejected.
- A **straight-set** match is decided by exactly one game; a second game is
  rejected, and there is no "best of 2".

### Snapshot and locking

- `generateKnockout()` snapshots each round's rule onto the match it creates
  (`match.scoring`), so a later settings change never rewrites a live match.
- `knockoutRulesLocked()` is `state.knockout.started === true ||
state.matches.some(m => m.stage !== 'group')` — a durable latch set by
  `generateKnockout()`, or the presence of any knockout match. It is derived, not
  stored as its own flag.
- `setKnockoutRule` refuses an edit once locked
  ("Knockout scoring is locked because the knockout stage has started.").
- `clearKnockout('safe')` refuses to destroy a played bracket; an unplayed
  bracket clears and releases the latch.

## Implementation notes (V2)

- V2 stores the per-round rule catalogue on the **KNOCKOUT stage**
  (`tournament_stages.knockoutRules`, a nullable JSONB column) and snapshots the
  resolved rule onto each match (`matches.knockoutFormat`,
  `matches.knockoutPointsPerGame`).
- V2 derives the lock from the same signal V1 uses: any match existing on the
  KNOCKOUT stage locks its rules (V1's `started` latch is set by
  `generateKnockout()`, which creates those matches in the same step, so the two
  are equivalent).
- V2's knockout rounds are generic powers of two; the round key is derived from
  the bracket size and round number (`knockoutRoundKey`), so a 4-entry bracket's
  first round is `SF` and a 2-entry bracket's only round is `FINAL`.
- Knockout games are **uncapped** in V2 too, matching V1; group games keep the
  21/30/2 rule set.

### Database change

`match_games_points_in_range` originally capped both point columns at 30 (from
the `add_match_scoring` migration). An uncapped knockout game (e.g. 31-29 at the
30-point target) is legal, so the forward-only migration
`20261001070000_relax_match_game_points_cap` widens the structural bound to
`0..198` (`MAX_POINTS_PER_GAME` + `MAX_KNOCKOUT_EXTENSION`). The database stays
the structural boundary, not the rule engine: the round's exact target and the
two-point margin remain enforced in `@badminton/domain`, and a group game's
30-point cap is a domain rule, unchanged. The historical migration is not
modified.

## Verification

- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm test` — 937 passed (54 files); web 187 passed (18 files).
- `npm run build` — succeeds (the pre-existing >500 kB chunk warning only).
- `npm run test:e2e` — 18 passed, including the new
  `e2e/knockout-scoring.spec.ts` (round targets, straight-set final, 31-29 past
  30, and the config lock once the knockout starts).
- `tests/integration/database/tournament-database.test.ts` asserts the widened
  bound accepts 31-29 and still rejects 199 and -1.

## Out of scope

Result correction, scheduler parity, team levels, backup/restore and the other
TASK-5 gaps are untouched, per the brief.
