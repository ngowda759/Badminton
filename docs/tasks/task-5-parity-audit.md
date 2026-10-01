# TASK-5 — V1 → V2 Functional Parity Audit

Read-only investigation. **No implementation was performed.** This document records
what V1 (`ngowda759/Tournament`) does, what V2 (`ngowda759/Badminton`) does, and
where they diverge.

Sources of truth inspected:

- **V1** — `index.html` (single-file app, 6076 lines; `TM` core + `App` UI),
  `tests/core.test.js` (4105 lines), `tests/render.test.js` (1085 lines),
  `README.md`. Cloned to `/tmp/v1-tournament` at `main` (`129e43e`).
- **V2** — `main` at `0d8ef46` (TASK-4 merged, PR #22). Domain, application,
  infrastructure, API routes, web pages, Prisma schema, migrations, e2e specs.

> **The scoring discrepancies below are load-bearing for the rest of the matrix.**
> V2 was built from `docs/phase-5-group-scoring.md` and `docs/phase-6-knockout.md`,
> which define a _best-of-three, 21/30/2_ scoring model and a _wins → game
> difference → point difference → entry-id_ standings order. That is **not** what
> V1 does. The V2 docs are internally consistent and their tests pass — the
> divergence is a product-parity gap, not a bug in V2's own contract.

---

## 0. Summary

> **Resolution status (TASK-6).** The high-severity scoring gaps **G1, G2 and G3**
> are now closed: a GROUP match is a single game to 21 (win 2 / loss 0), a
> KNOCKOUT match stays best of three (loss 1), and standings order is points →
> point difference → points scored → competitor name → entry id. See
> `docs/phase-5-group-scoring.md` and the `AGENTS.md` scoring gotcha. G4–G16
> remain open (they are separate parity areas, not group-scoring).

| Area                               | Status                                 |
| ---------------------------------- | -------------------------------------- |
| A. Tournament setup                | **PARTIAL**                            |
| 4. Players & teams                 | **PARTIAL**                            |
| 5. Group configuration             | **PARTIAL**                            |
| 6. Group fixture generation        | **PASS** (verify only; do not rewrite) |
| 7. Group scoring                   | **PASS** (fixed in TASK-6)             |
| 8. Standings                       | **PASS** (fixed in TASK-6)             |
| 9. Qualification                   | **PARTIAL**                            |
| 10. Knockout configuration         | **FAIL**                               |
| 11. Knockout progression           | **PASS**                               |
| 12. Courts                         | **FAIL**                               |
| 13. Scheduler                      | **FAIL**                               |
| 14. Settings & export/import/reset | **FAIL**                               |
| 15. Validation                     | **PARTIAL**                            |

---

## 1. A — Tournament setup

| Concern               | V1                                                                                   | V2                                                                                                | Status             |
| --------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------ |
| Creation fields       | `tournament.name`; no description/dates/location/timezone                            | name, description, start/end date, location, timezone (IANA)                                      | V2 superset (PASS) |
| Lifecycle states      | none (no tournament status; only group-stage/knockout derived phases)                | `DRAFT → REGISTRATION_OPEN → REGISTRATION_CLOSED → IN_PROGRESS → COMPLETED`, `CANCELLED` terminal | V2 superset (PASS) |
| Editing rules         | pairs/groups editable pre-results; structural change post-results needs confirmation | `COMPLETED`/`CANCELLED` read-only; `IN_PROGRESS` editable (`tournament.service.ts:177-184`)       | PASS               |
| Completed restriction | n/a                                                                                  | `assertEditable` blocks edits on terminal statuses                                                | PASS               |

**Evidence.** V1 has no tournament-level lifecycle (grep `status` in V1 core only
finds match status). V2: `packages/domain/src/lifecycle-tables.ts:18-25`,
`packages/application/src/services/tournament.service.ts:117-141`.

**Gap:** none material. V2 is a strict superset. **PASS.**

---

## 4 — Players & teams

| Concern                     | V1                                                                     | V2                                                                                                                        | Status                                                  |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Player model                | players are just a `players[]` string list on a pair; no player entity | first-class `Player` (name/email/phone, unique email/phone)                                                               | V2 superset (PASS)                                      |
| Pair ("team")               | `teams[]` with `{id, group, name, players[], level}`                   | first-class `Team` + `TeamMember` (position), global reusable roster                                                      | V2 superset (PASS)                                      |
| Doubles / singles           | **doubles only**; a "pair" is the competitor                           | `SINGLES` (player entry) and `DOUBLES` (team entry), category `format`                                                    | V2 superset (PASS)                                      |
| Add/edit/remove pair        | Teams screen, add/remove/rename, edit players                          | `/teams` + `/teams/:id`, add/remove member, rename                                                                        | PASS                                                    |
| Duplicate handling          | duplicate pair names rejected tournament-wide; duplicate ids rejected  | duplicate player email/phone, duplicate team membership, duplicate entry per category, player-in-two-teams (invariant 17) | PASS (V2 stricter)                                      |
| Withdrawal/deactivation     | remove a pair (structural → regenerate)                                | `WITHDRAWN`/`DISQUALIFIED` entry states, terminal; `ACTIVE_ENTRY_STATUSES = PENDING/CONFIRMED`                            | V2 superset (PASS)                                      |
| Operator never enters UUIDs | n/a (localStorage ids internal)                                        | players/teams chosen via `PlayerSelector`/`TeamSelector` dropdowns                                                        | PASS — **except** optional "Open by ID" cards (see gap) |

**Gap (minor):** V2 exposes optional "Open tournament/player/team by ID" cards that
ask for a raw UUID (`tournament-entry.tsx:161-191`, `players.tsx:273-313`,
`teams.tsx:262-303`). These are navigation shortcuts only — the normal
create/register flow never needs a UUID. V1 has no equivalent because it has no
URL-addressed entities. **Not a parity defect; leave unchanged.**

**Gap (parity, expected):** V1 has no `level`/`Tunga/Bhadra/Kaveri` equivalent in
V2 (see §14). V1's pair-level concept is absent in V2.

---

## 5 — Group configuration

V1 "groups" and V2 "groups" are **different abstractions**.

| Concern                                                    | V1                                                                                                                  | V2                                                                                                                   | Status                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| What a group is                                            | a stable container (`groups: { A: [teamId…] }`) with an optional cosmetic label; a _sub-division of one tournament_ | a `GROUP` **stage** (a row in `tournament_stages`); multiple group stages per category are the multi-group mechanism | **PARTIAL — different model** |
| Number of groups                                           | 1–8 (`MAX_GROUPS = 8`)                                                                                              | unbounded (one stage per group)                                                                                      | PASS                          |
| Group names                                                | ids `A`, `B`, … + optional friendly label (`groupLabels`)                                                           | `name` on the stage (default label `Group X` shown in UI)                                                            | PASS                          |
| Add group                                                  | `addGroup()` → empty group, never moves pairs, non-structural                                                       | create another GROUP stage                                                                                           | PASS (equivalent outcome)     |
| Rename group                                               | `renameGroup()` — cosmetic label only, never touches fixtures                                                       | `PATCH /stages/:id` name (blocked when stage `COMPLETED`)                                                            | PASS                          |
| **Remove group**                                           | `removeGroup()` — allowed only for an **empty** group; refuses a non-empty group and the last group                 | **no delete route/service for a stage at all**                                                                       | **FAIL**                      |
| Group membership                                           | assign pairs to a group on Teams/Settings                                                                           | a group stage's membership = the entries passed to `POST /stages/:id/fixtures` (`entryIds`)                          | PARTIAL                       |
| Pair count / fixture count / qualification count per group | derived and shown per group row                                                                                     | shown per stage; qualification count on the GROUP stage                                                              | PASS                          |
| Group regeneration                                         | add/remove/rename never regenerates                                                                                 | fixtures generated once; regeneration → 409                                                                          | PASS                          |
| Structural-change protection                               | non-structural group ops never clear results; structural pair moves need confirmation                               | fixture generation rejected when matches exist (409)                                                                 | PARTIAL (see note)            |
| Hard-coded group ids                                       | **no** — ids are dynamic (`nextGroupId`, A…Z then AA…), fixtures generated from actual membership                   | **no** — groups are stages, created dynamically                                                                      | PASS                          |

**Evidence.**

- V1: `index.html` `addGroup` (3400), `removeGroup` (3412), `renameGroup` (3428),
  `nextGroupId` (3377), `groupIds` (1617), `buildGroupMatches` (1635),
  `validateGroups` (3224).
- V2: `prisma/schema.prisma:200-220` (`TournamentStage`), no delete in
  `stage.service.ts:39-45`, `stage-match.routes.ts` (get/post/patch/transition only).

**Gap 5.1 (FAIL):** V1 lets an operator **remove an empty group**; V2 cannot remove
a stage at all. This is a genuine operator-workflow gap (a mis-created group is
permanent).

**Note:** V2's structural guard is "fixtures already generated → 409", whereas V1
allows group membership to change _with confirmation_ before/after results and then
regenerates. V2 has no membership-edit/regenerate-confirm flow (see §6).

---

## 6 — Group fixture generation

**Verdict: PASS — do not rewrite.** Verified only.

| Concern                    | V1                                                          | V2                                                                                 | Status |
| -------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| Algorithm                  | circle method (`roundRobin`, index.html:1027)               | circle method (`roundRobinRounds`, `packages/domain/src/round-robin.ts`)           | PASS   |
| Match count                | `n(n−1)/2` per group                                        | `roundRobinMatchCount` = `n(n−1)/2`; service rejects <2 entries                    | PASS   |
| Odd group                  | bye rotates, never emitted as a match                       | `rotation.push(undefined)` + unconditional splice-back (the documented PR #21 fix) | PASS   |
| Membership                 | actual group membership                                     | caller-supplied `entryIds`                                                         | PASS   |
| Ordering                   | caller/group order, stage-unique `sequence` + `roundNumber` | caller order (`entryIds`), stage-unique `sequence` + `roundNumber`                 | PASS   |
| Duplicate prevention       | regenerate is explicit                                      | `existing.length > 0` → 409                                                        | PASS   |
| Persistence                | `matches` array in localStorage                             | `matches`/`match_participants` tables, one `UnitOfWork`                            | PASS   |
| Completed-match protection | regenerate refused while knockout played                    | generation refused when matches exist                                              | PASS   |

**Evidence.** V1 `index.html:1027-1044,1635-1660`; V2
`packages/domain/src/round-robin.ts`, `group-fixture.service.ts`,
`tests/unit/domain/round-robin.test.ts`, `e2e/group-fixtures.spec.ts`.

---

## 7 — Group scoring

**Verdict: PASS (TASK-6) — V2 now matches V1.** Was **FAIL** at audit time; the
divergence below is preserved as the record of what changed.

| Concern                       | V1 (source of truth)                                                                            | V2 (after TASK-6)                                                                  | Status                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------- |
| Group match format            | **single game to 21** (`GROUP_TARGET = 21`, `GROUP_CAP = 30`)                                   | **single game to 21** (`scoreGroupMatch`)                                          | **PASS**                     |
| Win / loss points             | win = **2**, loss = **0** (`GROUP_WIN_POINTS=2`, `GROUP_LOSS_POINTS=0`)                         | win = 2, group loss = **0** (`STANDING_GROUP_LOSS_POINTS`)                         | **PASS**                     |
| Points scored / conceded      | `pf`/`pa` from the single game score                                                            | `pointsFor`/`pointsAgainst` from the single game                                   | **PASS**                     |
| Point difference              | `pf − pa`                                                                                       | `pointsFor − pointsAgainst`                                                        | **PASS**                     |
| Played / wins / losses        | per completed match                                                                             | per completed match                                                                | PASS                         |
| Completed vs incomplete       | completed only counts                                                                           | completed only counts                                                              | PASS                         |
| Invalid score handling        | tie, sub-21, non-2-clear rejected                                                               | tie, sub-21, non-2-clear rejected                                                  | PASS                         |
| Correction of existing result | **`saveGroupScore` re-entry**; while a bracket exists, correction must go through ↺ Reset first | **no correction** — `COMPLETED` is immutable, `recordResult` rejects re-completion | **FAIL (unchanged, gap G6)** |

**Evidence.**

- V1: `index.html` `validateGroupScore` (2051), `saveGroupScore` (2150), constants
  (829-833); UI copy `'Single game to 21 points — win by 2 clear points (30-point
cap)'` (index.html:3982); tests `tests/core.test.js:76-101` (`21-17 valid`,
  `21-21 tie rejected`, `21-20 rejected`, `30-29 valid`, `winner gets 2 points`,
  `loser gets 0 points`).
- V2 (after TASK-6): `packages/domain/src/scoring.ts` (`scoreGroupMatch`,
  single game 21/30/2; `scoreMatchGames` best of three for KNOCKOUT);
  `standings.ts` (`STANDING_GROUP_LOSS_POINTS = 0`); `match-result.service.ts`
  reads the stage type inside the transaction to choose the format;
  `e2e/group-scoring.spec.ts` (enters a single game 21-18).

**Impact (pre-TASK-6):** every V1 group result (a single 21-x score) was recorded
in V2 as a 2-game best-of-3; V2 standings awarded the loser a point and ordered
by wins/games rather than points/diff/PF, which changed who qualified. TASK-6
closed this.

---

## 8 — Standings

**Verdict: PASS (TASK-6) — V2 now matches V1.** Was **FAIL** at audit time.

| Concern                  | V1 (source of truth)                                                                            | V2                                                                                                                     | Status                   |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Ordering                 | 1. points desc, 2. point difference desc, 3. points scored desc, 4. team name (`localeCompare`) | 1. points desc, 2. point difference desc, 3. points scored desc, 4. competitor name (`localeCompare`), 5. entry id asc | **PASS**                 |
| Columns                  | `# · Team · P · W · L · Pts · PF · PA · Diff`                                                   | `Pos · Competitor · P · W · L · Pts · PF · PA · Diff`                                                                  | PASS                     |
| Ties on points           | broken by point difference                                                                      | broken by point difference                                                                                             | PASS                     |
| Ties on point difference | broken by PF                                                                                    | broken by PF                                                                                                           | PASS                     |
| Multiple groups          | independent tables                                                                              | independent per stage                                                                                                  | PASS                     |
| Incomplete group         | every pair shows from zero                                                                      | every active entry shows from zero                                                                                     | PASS                     |
| Corrected result         | recomputed from results                                                                         | not possible (result immutable)                                                                                        | FAIL (unchanged, gap G6) |

**Evidence.**

- V1: `computeStandings` (index.html:1853-1881):
  `(b.pts-a.pts) || (b.diff-a.diff) || (b.pf-a.pf) || a.team.name.localeCompare(b.team.name)`;
  README §Scoring "Tie-breaks"; `tests/core.test.js:4048-4082` (TEST 6: equal
  points → point difference → points scored; `more points scored ranks first`).
- V2: `packages/domain/src/standings.ts` (`calculateStandings`; comparator
  points → point difference → pointsFor → name → entry id);
  `standings-compute.ts` `buildNameResolver` (one batched players/teams read for
  the name tie-break); `docs/phase-5-group-scoring.md` §8 "Tie-breaking order".

---

## 9 — Qualification

| Concern                  | V1                                                          | V2                                                                   | Status               |
| ------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------- | -------------------- |
| Config location          | `settings.qualification.perGroup` (single value, default 4) | `tournament_stages.qualifiersPerGroup` on the feeder GROUP stage     | PASS (equivalent)    |
| Top-N per group          | yes, clamped to group size (`Math.min(per, size)`)          | yes, clamped to group members (`Math.min(perGroup, members.length)`) | PASS                 |
| Multiple groups          | all groups contribute                                       | all feeder GROUP stages contribute                                   | PASS                 |
| Insufficient competitors | small group qualifies all                                   | small group qualifies all                                            | PASS                 |
| Incomplete group         | `generateKnockout` requires `groupStageComplete()`          | `pendingMatches > 0` → blocked                                       | PASS                 |
| Ties around boundary     | resolved by the standings order (§8)                        | resolved by the standings order (§8)                                 | PASS (fixed with §8) |
| Qualification ordering   | standing order per group                                    | standing order per group                                             | PASS                 |
| Qualification locking    | refused once bracket exists (`setQualification`)            | derived, never stored; bracket generation reads it                   | PASS                 |
| Persistence              | stored in `settings.qualification`                          | stored on the stage row                                              | PASS                 |
| Hard-coded count         | no (configurable, default 4)                                | no (nullable, operator-set, no default)                              | PARTIAL — see gap    |

**Evidence.** V1 `qualifiedPerGroup` (2353), `getQualifiedTeams` (2362),
`setQualification` (3483); V2 `qualification.service.ts:80-168`,
`packages/domain/src/qualification.ts`, migration `add_stage_qualification`.

**Gap 9.1 (minor):** V1 defaults `perGroup` to **4**; V2 leaves
`qualifiersPerGroup` **null** with no default (operator must set it, else
qualification is blocked). Behaviourally equivalent once set, but V2 has no default.

**Gap 9.2 (closed by TASK-6):** qualification inherits the §8 standings order,
which now matches V1 (points → point difference → points scored → name), so "who is
top N" is the same.

---

## 10 — Knockout configuration

**Verdict: FAIL.**

| Concern                        | V1                                                                                                      | V2                                                                                | Status               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------- |
| Start/generation               | explicit **Generate / Start knockout** (`generateKnockout`)                                             | explicit `POST /stages/:id/bracket` or `/bracket/generate`                        | PASS                 |
| Qualification count            | `settings.qualification.perGroup`                                                                       | `qualifiersPerGroup` on feeder GROUP stage                                        | PASS                 |
| Bracket size                   | next power of two ≥ qualifiers                                                                          | `smallestSupportedSize` over `[2,4,8,16,32,64,128]`                               | PASS                 |
| Round names                    | `R32/R16/QF/SF/Final` (`KNOCKOUT_ROUNDS`)                                                               | `bracketRoundName`: Final/Semifinals/Quarterfinals/Round of N                     | PASS (label differs) |
| Byes                           | spread evenly, to strongest interleaved seeds, auto-advance, never a match                              | same rule (`buildPairings`, `rankInterleavedStrongest`)                           | PASS                 |
| **Per-round scoring format**   | **configurable** per round: Best of 3 / Straight set, points per game (QF 11, SF 15, Final 21 defaults) | **none** — one fixed best-of-3 21/30/2 model for all rounds                       | **FAIL**             |
| **Best-of-3 configuration**    | yes, per round (`setKnockoutRule`)                                                                      | no                                                                                | **FAIL**             |
| **Knockout rule locking**      | `knockoutRulesLocked()` — durable `knockout.started` latch; edits refused once started                  | n/a (no rules to lock)                                                            | **FAIL** (absent)    |
| Generation protection          | explicit step; refused if bracket exists                                                                | 409 if bracket exists                                                             | PASS                 |
| Restart/regeneration           | `clearKnockout`; reset unplayed bracket to reconfigure                                                  | no delete/reset bracket route                                                     | **FAIL**             |
| Dynamic bracket sizes (4/8/16) | 2→Final, 4→SF+Final, 8→QF onward (7), 16→R16 onward (15), up to 32                                      | supported sizes 2–128; `e2e/knockout-bracket.spec.ts` exercises a 4-entry bracket | PASS                 |

**Evidence.**

- V1: `KNOCKOUT_ROUNDS` (index.html:834-839), `DEFAULT_KNOCKOUT_RULES` (855),
  `setKnockoutRule` (3534), `knockoutRulesLocked` (3511), `generateKnockout`
  (2440), `bracketRounds` (2335); tests `tests/core.test.js:2955-3019`
  (`default: QF points 11`, `set Final straight 21 ok`, lock refusal).
- V2: repo-wide grep for `bestOf|straightSet|pointsPerGame|roundFormat` → **zero
  matches**; `packages/domain/src/scoring.ts` is a single fixed rule set.

**Gap 10.1 (FAIL):** V2 has **no per-round knockout scoring configuration** (format
and points target). V1's QF=11 / SF=15 / Final=21 defaults and its "Straight set"
option are entirely absent. This is the single largest knockout gap.

**Gap 10.2 (FAIL):** V2 has no "reset/clear bracket" or "knockout rules locked"
concept. A completed result is immutable and a bracket cannot be regenerated.

---

## 11 — Knockout progression

**Verdict: PASS — audit, do not replace.**

| Concern                    | V1                                                                       | V2                                                                     | Status            |
| -------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------- |
| Qualifier → participant    | `generateKnockout` seeds first round from standings                      | `generateFromQualifiers` → `buildBracketSeed`                          | PASS              |
| Winner → next round        | `ensureKnockout`/`populatedPairing` fills next round from feeder winners | `knockout-progression.service.ts:46-99` `calculateNextBracketPosition` | PASS              |
| QF → SF → Final → champion | derived from live match state                                            | derived; stage completes on final `COMPLETED`                          | PASS              |
| Bye auto-advance           | bye is an already-decided match, never schedulable                       | bye pairing `second: null`, advanced at generation                     | PASS              |
| Idempotency / duplicate    | re-generation refused                                                    | `progress` returns `false` on no-op; different entry → `ConflictError` | PASS              |
| Atomic with result         | `saveKnockoutScore` → `ensureKnockout`                                   | progression runs in the same `UnitOfWork` as `recordResult`            | PASS              |
| Bracket dependency         | `sourceA/sourceB` re-derived from feeder winner                          | slot filled with the resolved winner (no re-derivation)                | PASS (V2 simpler) |

**Evidence.** V1 `ensureKnockout` (2560), `populatedPairing` (2528),
`reconcileBracket` (2730); V2 `knockout-progression.service.ts`,
`packages/domain/src/bracket.ts:87-96`, `e2e/knockout-bracket.spec.ts`,
`e2e/tournament-progression.spec.ts`.

**Note:** V1's `sourceA/sourceB` re-derivation exists to support _result
correction_ (a corrected earlier result flows downstream). V2 has no correction
workflow, so it fills the slot once — consistent with its own design, but it means
a V1-style correction flow cannot be layered on without revisiting this (§7/§10).

---

## 12 — Courts

**Verdict: FAIL.**

| Concern                       | V1                                                          | V2                                                                 | Status                       |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------- |
| Fields                        | `{ id, name, startTime, endTime, enabled, closed }`         | `{ id, number, name, status: ACTIVE/INACTIVE }`                    | **FAIL**                     |
| Availability window           | per-court `startTime`/`endTime` (e.g. 06:00–09:00)          | **none**                                                           | **FAIL**                     |
| Count                         | 1–8 (`MIN_COURTS`/`MAX_COURTS`), add/remove, reduce→disable | unbounded; add via `POST`, no max, **no delete** (deactivate only) | PARTIAL/FAIL                 |
| Rename                        | yes                                                         | yes (`PATCH /courts/:id`)                                          | PASS                         |
| Enable/disable                | `enabled` toggle + transient `closed`                       | `ACTIVE`/`INACTIVE` transition                                     | PASS                         |
| Remove court                  | yes, refuses if a match is in progress                      | no delete                                                          | **FAIL**                     |
| Validation                    | name/time/count, atomic reject                              | number positive+unique per tournament, name non-empty              | PARTIAL (no time validation) |
| Config survives reload/backup | yes                                                         | yes (DB)                                                           | PASS                         |

**Evidence.** V1 `DEFAULT_COURTS` (1006-1009), `validateCourts` (1124),
`setCourtCount` (1170), `addCourt` (1218), `removeCourt` (1235);
`prisma/schema.prisma:297-311`; `court.service.ts`; `e2e/phase7-courts-dashboard.spec.ts`.

---

## 13 — Scheduler

**Verdict: FAIL.**

| Concern                             | V1                                                                                                                        | V2                                                                           | Status                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------- |
| Model                               | **rolling scheduler**: per idle court, suggest the next eligible match                                                    | **manual**: operator assigns one match to a court + `[start,end)` window     | **FAIL**                   |
| Eligibility ranking                 | deterministic: avoid back-to-back → longest-waiting least-rested → group interleave → generation order (`rankCandidates`) | none                                                                         | **FAIL**                   |
| Explanation shown                   | yes ("Naveen & Chandan waited 3 · …")                                                                                     | none                                                                         | **FAIL**                   |
| Hard guarantees                     | team never on two courts; court never double-booked; completed never restarted; disabled court never scheduled            | GiST EXCLUDE + app pre-check for court-time overlap; match must be SCHEDULED | PARTIAL                    |
| Availability windows (half-open)    | gate starting a new match; in-progress unaffected                                                                         | no hours model at all                                                        | **FAIL**                   |
| Out-of-hours override setting       | `allowOutsideAvailability`                                                                                                | n/a                                                                          | **FAIL** (absent)          |
| Conflict rule                       | team/court busy                                                                                                           | GiST `EXCLUDE` `[start,end)` per court + CHECKs                              | PASS (different mechanism) |
| Fairness / monotonic `completedSeq` | yes (`meta.seq`)                                                                                                          | none                                                                         | **FAIL**                   |

**Evidence.** V1 `rankCandidates` (1924-1960), `suggestCourts` (1994),
`startMatch` (2024), `courtAcceptsNewMatch` (1963);
`match-scheduling.service.ts:17-34` ("The operator decides where and when a match
is played; this service only guarantees the decision is valid"),
`packages/domain/src/scheduling.ts`, migration `add_courts_scheduling`.

---

## 14 — Settings & export/import/reset

**Verdict: FAIL — most V1 settings features are absent.**

| Concern                                                                                                  | V1                                                                                 | V2                                    | Status          |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- | --------------- |
| Central Settings screen                                                                                  | yes (tournament, groups, qualification, levels, courts, regenerate, backup, reset) | no equivalent; scattered across pages | **FAIL**        |
| Tournament name config                                                                                   | yes                                                                                | yes (edit page)                       | PASS            |
| Groups config                                                                                            | yes                                                                                | stage list (no delete)                | PARTIAL         |
| Qualification config                                                                                     | yes                                                                                | stage edit form (GROUP only)          | PASS            |
| Knockout scoring config                                                                                  | yes                                                                                | **none**                              | FAIL (§10)      |
| Regenerate fixtures                                                                                      | yes (with before/after plan)                                                       | generate-once only (409)              | PARTIAL         |
| **Team level configuration** (Tunga/Bhadra/Kaveri; add/rename/enable/remove; canonical resolver; repair) | yes                                                                                | **none**                              | **FAIL**        |
| Court configuration                                                                                      | yes                                                                                | yes (manage page)                     | PASS            |
| Scheduling setting (out-of-hours)                                                                        | yes                                                                                | **none**                              | FAIL (§13)      |
| **Export backup (JSON)**                                                                                 | yes (`exportJSON`, `Tournament-backup-*.json`)                                     | **none**                              | **FAIL**        |
| **Import backup**                                                                                        | yes (`importJSON`, validates file)                                                 | **none**                              | **FAIL**        |
| **Reset tournament**                                                                                     | yes                                                                                | **none**                              | **FAIL**        |
| **Clear results only**                                                                                   | yes                                                                                | **none**                              | **FAIL**        |
| localStorage persistence                                                                                 | `shuttledraw_v4`                                                                   | PostgreSQL (server)                   | PASS (superset) |

**Evidence.** V1 `exportJSON` (1826), `importJSON` (1828), `resetTournament`
(1845), level resolver `resolveLevel` (1325), `repairTeamLevels` (1448),
Settings UI (5740-5748). V2: grep for `backup|restore|clear results|reset
tournament|export|import` in `apps/web/src` and `apps/api/src` → no functional
matches; grep for `Tunga|Bhadra|Kaveri|level` → none.

---

## 15 — Validation

| Rule                                                                   | V1                             | V2                                                                                | Status                     |
| ---------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------- | -------------------------- |
| Team on two simultaneous matches                                       | enforced                       | enforced (knockout start requires filled slots; court overlap)                    | PASS                       |
| Completed match cannot restart                                         | enforced                       | enforced (`COMPLETED` terminal)                                                   | PASS                       |
| Match cannot start until both teams known                              | enforced                       | enforced for KNOCKOUT (`assertKnockoutReadyToStart`)                              | PARTIAL                    |
| Valid scores required                                                  | enforced (single game 21/30/2) | enforced (best-of-3 per game 21/30/2)                                             | PASS (rules differ)        |
| Knockout set validation vs round target                                | enforced                       | fixed 21/30/2                                                                     | FAIL (no per-round target) |
| Third set after 2-0 rejected                                           | enforced                       | enforced                                                                          | PASS                       |
| First KO round only after group complete                               | enforced                       | enforced                                                                          | PASS                       |
| Qualification ≤ largest group                                          | enforced                       | clamped, not rejected                                                             | PARTIAL                    |
| Structural change needs confirmation                                   | enforced (with regenerate)     | 409, no confirm/regenerate flow                                                   | PARTIAL                    |
| 2–32 pairs, ≥2 per group, ≤8 groups, unique names, every pair assigned | enforced                       | V2 has no pair-count/group-count caps; duplicates handled differently             | PARTIAL                    |
| Destructive ops require confirmation                                   | enforced                       | confirm dialogs on terminal transitions                                           | PASS                       |
| **"No operator needs UUIDs"**                                          | n/a                            | entries via dropdowns; slot assignment on match-detail uses **entry-UUID inputs** | PARTIAL                    |

**Evidence.** V1 `validateTeams` (3186), `validateGroups` (3224),
`validateGroupScore` (2051), `validateKnockoutSets` (2073). V2
`match.service.ts:261-296`, `match-result.service.ts`, `match-detail.tsx`
participant UUID inputs.

**Gap 15.1:** `match-detail.tsx` assigns participants by raw entry UUID (the e2e
specs resolve ids via the API). V1 never asks an operator for an id. This is a
usability parity gap, though it lives in the Phase 5 UI rather than the setup flow.

---

## 16. Consolidated gap register

| #   | Gap                                                                          | V1 evidence                                             | V2 evidence                           | Severity |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------- | -------- |
| G1  | Group match is best-of-3 in V2, single game to 21 in V1                      | `index.html:829-833,2051,3982`; `core.test.js:76-101`   | `scoring.ts:27-42`                    | **High** |
| G2  | Standings order differs (V2 uses wins → game diff → point diff → id)         | `index.html:1874`; `core.test.js:4048-4082`             | `standings.ts:162-177`                | **High** |
| G3  | Loss points: V1 = 0, V2 = 1                                                  | `index.html:831`; `core.test.js:96`                     | `standings.ts:64`                     | **High** |
| G4  | No per-round knockout scoring config (format + points/game)                  | `index.html:834-896,3534`; `core.test.js:2955-3019`     | absent (grep: 0 hits)                 | **High** |
| G5  | No knockout rule lock / reset / regenerate                                   | `knockoutRulesLocked` 3511; `clearKnockout` 2246        | absent                                | **High** |
| G6  | Completed result not correctable                                             | `saveGroupScore` 2150; `resetMatch` 2297                | `match-result.service.ts:69-71`       | **High** |
| G7  | No rolling court scheduler / eligibility ranking / fairness                  | `rankCandidates` 1924; `suggestCourts` 1994             | `match-scheduling.service.ts:17-34`   | **High** |
| G8  | No court availability windows / out-of-hours override                        | `courtAcceptsNewMatch` 1963; `allowOutsideAvailability` | absent                                | **High** |
| G9  | No export / import / reset / clear-results                                   | `exportJSON`/`importJSON`/`resetTournament` 1826-1845   | absent                                | **High** |
| G10 | No configurable team levels (Tunga/Bhadra/Kaveri) + repair                   | `resolveLevel` 1325; `repairTeamLevels` 1448            | absent                                | Medium   |
| G11 | Cannot remove a group/stage or a court                                       | `removeGroup` 3412; `removeCourt` 1235                  | no delete routes                      | Medium   |
| G12 | No pair/group count caps (2–32 pairs, ≤8 groups)                             | `validateTeams` 3186; `validateGroups` 3224             | absent                                | Low      |
| G13 | Qualification has no default (V1 defaults to 4)                              | `DEFAULT_QUALIFY_PER_GROUP=4`                           | `qualifiersPerGroup` nullable         | Low      |
| G14 | Match-detail assigns participants by raw entry UUID                          | n/a (no ids exposed)                                    | `match-detail.tsx` participant inputs | Low      |
| G15 | No "regenerate fixtures" confirm flow (V2 = hard 409)                        | `regeneratePlan`/`regenerateFixtures` 3440-3452         | `group-fixture.service.ts`            | Medium   |
| G16 | Group = stage; no independent group rename/membership editing after creation | `renameGroup`, `assignTeamToGroup`                      | `PATCH /stages/:id` name only         | Low      |

---

## 17. Recommended TASK-5 implementation scope (not performed)

Ordered by parity value; each is a separate, reviewable change and none should
regress PR #18/#20/#21 or TASK-4.

1. **G1/G3 — group scoring model.** Record a GROUP match as a single game to 21
   (2/0 points), keeping best-of-3 for KNOCKOUT. This touches `scoring.ts`
   (add a group rule set), `match-result.service.ts`, `standings.ts`
   (loss points per stage type), the API validation and `match-scoring.tsx`.
   _High risk — changes existing persisted-result semantics; needs a migration/
   back-compat decision._
2. **G2 — standings order.** Align the comparator to points → point difference →
   points scored → name (locale-stable). Requires a deterministic name source
   (V2 stores names on players/teams).
3. **G4/G5 — knockout round rules.** Add per-round `{format, pointsPerGame}` to the
   KO stage, snapshot onto matches, lock once started, and expose it in the stage
   form.
4. **G6 — result correction.** A guarded reset/re-enter flow (and bracket
   re-derivation) — the largest single workflow addition.
5. **G7/G8 — scheduler.** Either a rolling suggest endpoint over the existing
   court/time model, or an explicit decision to keep manual scheduling (product
   call).
6. **G9 — export/import/reset.** Add JSON export/import and reset/clear-results
   endpoints + Settings UI.
7. **G10 — team levels.** Configurable levels, canonical resolver, repair.
8. **G11–G16 — smaller parity fixes** (stage/court delete, caps, defaults,
   dropdown-based participant assignment, regenerate confirmation).

**Do not** implement any of the above until the group-scoring and standings
semantics (G1–G3) are agreed, because every other area (qualification, knockout
seeding, dashboard) depends on them.
