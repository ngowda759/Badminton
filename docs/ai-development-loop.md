# AI development loop

The repository owns a closed, **automatic** development loop:

```
ChatGPT architect  →  OpenHands implementation  →  GitHub PR
        ↑                                              ↓
        │                                        GitHub Actions CI
        │                                              ↓
        │                                        ChatGPT PR review
        │                                              ↓
        │                              ┌───────────────┴───────────────┐
        │                              │                               │
        │                           approved                  changes-requested
        │                              │                               │
        │                              ▼                               ▼
        │                        Human merge                   OpenHands fix
        │                                                              │
        │                                                              ▼
        │                                                             CI
        │                                                              │
        │                                                              ▼
        │                                                    ChatGPT re-review
        │                                                              │
        │                                                   (round+1, max 3)
        │                                                              │
   next-task generation  ←  merge gate  ←  ─────────────────────────────┘
```

Every stage is a separate, auditable step. The loop is **infrastructure only**:
it never implements product features, never redesigns the web application, never
touches production data, and never merges a pull request.

## Who does what

| Actor          | Roles                                    |
| -------------- | ---------------------------------------- |
| ChatGPT        | Architect (task briefs) and **reviewer** |
| OpenHands      | Implementer and **fixer**                |
| GitHub Actions | CI and orchestrator                      |
| Human          | Task approval and final merge            |

The reviewer and the implementer are different actors **by design**. OpenHands
never reviews its own work: it implements, then fixes what ChatGPT reports. The
review stage is not an OpenHands conversation — it is
`.ai/scripts/chatgpt-review.mjs`, driven by the `AI loop review` workflow.

## Where things live

| Path                                       | Purpose                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `.ai/loop.config.json`                     | Loop knobs and guardrails (single source of truth)                        |
| `.ai/prompts/`                             | Stage prompts (system, architect, implementation, review, fix, next-task) |
| `.ai/schemas/`                             | JSON Schemas for config, state, task briefs and reviews                   |
| `.ai/state/`                               | Durable state, task queue and the append-only review log                  |
| `.ai/scripts/`                             | Dependency-free validation, state and review helpers                      |
| `.ai/templates/`                           | Markdown templates for briefs and reports                                 |
| `.openhands/skills/badminton-development/` | Repository skill: layering, commands, invariants                          |
| `.github/workflows/ai-loop-*.yml`          | The loop's GitHub Actions workflows                                       |

## Stage by stage

### 1. Architect — ChatGPT

Produces one task brief (`.ai/schemas/task-brief.schema.json`) with observable
acceptance criteria and an explicit out-of-scope list, written to
`docs/tasks/<id>-<slug>.md` and appended to `.ai/state/task-queue.json`.

### 2. Implementation — OpenHands

Implements exactly that brief on `automation/<task-id>-<slug>`, runs the
repository's validation commands, and opens **one** pull request. It records
`status: ci-running` and the PR in `.ai/state/loop-state.json`.

### 3. CI — GitHub Actions

The existing `CI` workflow (`.github/workflows/ci.yml`) is unchanged: lint,
typecheck, unit/integration tests, migrations, seed, build, and Playwright
end-to-end tests. The required check name comes from `requiredChecks` in
`.ai/loop.config.json`.

### 4. Review — ChatGPT (automatic)

`ai-loop-review.yml` fires on `opened`, `synchronize`, `reopened` and
`ready_for_review`, waits for the required checks to finish
(`.ai/scripts/wait-for-ci.mjs`), then runs `.ai/scripts/chatgpt-review.mjs`:

1. reads the PR (title, body, diff, checks, existing comments) as **data**;
2. derives the round and refuses to review a head SHA it has already reviewed;
3. asks the OpenAI Responses API for a strict, schema-constrained report;
4. applies the loop's own rules on top of the model's verdict;
5. appends the report to `.ai/state/review-log.jsonl`;
6. posts the report as a PR comment carrying the dedupe marker
   `<!-- ai-loop-review round=<n> head=<sha> verdict=<v> -->`;
7. routes the verdict.

The model never supplies the head SHA, PR number or round — those are recorded
from GitHub, so a review cannot claim to have reviewed a different commit than
the one it was given.

### 5. Fix — OpenHands (automatic)

On `changes-requested` below the round limit, the reviewer writes a fix context
and dispatches OpenHands with `--stage fix --pr <n> --branch <existing branch>`.
OpenHands fixes the findings on the **same** PR and branch, answers every finding
with `FIXED` or `DECLINED — <reason>`, re-validates, and pushes. It never opens a
second PR, never creates a second branch, never force-pushes over another
author's commits, and never merges.

The push fires `synchronize`, which runs CI and the next review round — no manual
step sits between a fix and its re-review.

### 6. Merge gate — human

`mergeGate.enabled` is `false`: automation only reports readiness. On `approved`
with green CI the loop applies `ai-ready`. The human checks CI, the review
verdict, the acceptance criteria, protected paths and the change size, then
merges — or returns the PR for another round, or blocks it.

### 7. Next-task generation — ChatGPT

Proposes exactly one next task and resets the loop to `idle` / round `0`.

## The review round limit

`maxReviewRounds` defaults to `3`. The round increments on each review; when it
reaches the limit with findings still open, the loop applies `ai-blocked`, marks
the task `blocked` and stops for a human instead of looping forever. It does not
dispatch another fix at that point.

## Anti-storm protection

A review costs money and time, so a duplicate trigger must be a no-op:

- the workflow is scoped to `automation/**` branches or a PR carrying
  `ai-review`, so unrelated pull requests are never reviewed;
- the reviewer refuses to review a head SHA that any previous review comment
  already covers, which holds even when the state file is stale;
- one run per pull request at a time (`concurrency`), newest wins.

## State machine

`loop-state.mjs set --status` enforces the loop's transitions:

```
idle → implementing → ci-running → reviewing ─┬→ ready → human-merge → complete
      ↑                                       └→ fixing → ci-running → reviewing
      └── blocked ← (any state)
```

`blocked` is reachable from anywhere, because a stage that cannot proceed must
always be able to stop for a human. An illegal step is refused unless `--force`
is passed, and a forced step is recorded in the history like any legal one.

## Guardrails encoded in the repository

- `protectedPaths` in `.ai/loop.config.json` (`prisma/migrations/**`,
  `prisma/seed.ts`, `.github/workflows/ci.yml`, `.env`, `.env.*`) are flagged by
  `detect-changed-areas.mjs` and require human review.
- `limits.maxChangedFiles` / `limits.maxDiffLines` bound a single change.
- A task with `humanApproval: false` is never picked up; the validator fails the
  loop if an unapproved task becomes active.
- `.ai/state/review-log.jsonl` is append-only and schema-validated. A review is
  never overwritten.

## Workflows

| Workflow                 | Trigger                                                                   | Purpose                                                  |
| ------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `ci.yml`                 | PR / push to `main`                                                       | Unchanged product CI                                     |
| `ai-loop-validate.yml`   | PR / push to `main` (paths `.ai/**`, `.github/workflows/**`, docs, skill) | Validate config, state, schemas and workflow structure   |
| `ai-loop-implement.yml`  | manual (`task_id`)                                                        | Dispatch one OpenHands implementation conversation       |
| `ai-loop-review.yml`     | PR `opened`/`synchronize`/`reopened`/`ready_for_review`, or manual        | Wait for CI, run the ChatGPT review, route the verdict   |
| `ai-loop-merge-gate.yml` | PR activity, or manual                                                    | Report merge readiness (never merges)                    |
| `ai-loop-next-task.yml`  | manual                                                                    | Dispatch the next-task conversation after the merge gate |

## Required GitHub Secrets

Configure these under **Settings → Secrets and variables → Actions**:

| Name                  | Kind     | Required | Purpose                                                          |
| --------------------- | -------- | -------- | ---------------------------------------------------------------- |
| `OPENAI_API_KEY`      | Secret   | Yes      | ChatGPT reviewer credential                                      |
| `OPENHANDS_API_KEY`   | Secret   | Yes      | Bearer token used to start OpenHands conversations               |
| `OPENHANDS_HOST`      | Variable | No       | OpenHands API base URL (defaults to `https://app.all-hands.dev`) |
| `OPENAI_REVIEW_MODEL` | Variable | No       | Review model override (defaults to `review.model` in the config) |

`GITHUB_TOKEN` is provided automatically by GitHub Actions and needs no
configuration. No database, Supabase or production credential is required by any
loop workflow — the loop never touches production data.

If `OPENAI_API_KEY` is absent, the review workflow skips the review, prints a
warning and reports it in the step summary, so an unconfigured secret never turns
the check red. The reviewer script itself fails loudly when invoked without the
key, so a review can never be silently skipped once the credential exists. If
`OPENHANDS_API_KEY` is absent, the fix dispatch prints a skip message and exits
`0`, so the review still publishes its findings. The CI workflow itself needs no
secret at all.

## Required permissions

- `ai-loop-validate.yml`: `contents: read`.
- `ai-loop-implement.yml`: `contents: read`.
- `ai-loop-review.yml`: `contents: read`, `checks: read`,
  `pull-requests: write`, `issues: write` — enough to read the PR and its checks
  and to post the review comment and labels, and nothing more.
- `ai-loop-merge-gate.yml`: `contents: read`, `checks: read`,
  `pull-requests: read`.
- `ai-loop-next-task.yml`: `contents: read`.

No workflow requests `contents: write`. Nothing in the loop can push, and nothing
in the loop can merge — pushing a fix is an OpenHands conversation action
performed with the user's own credentials, under the human's review.

## Security

The review workflow runs with `pull_request`, never `pull_request_target`, so a
fork pull request receives a read-only token and no secrets. Nothing from the PR
is checked out, installed, built or sourced: the diff is read as text and sent to
the reviewer, and the workflow explicitly skips a cross-repository pull request
rather than reviewing a diff it cannot verify. The OpenHands fix stage is
different on purpose — OpenHands is authenticated to the repository branch and is
responsible for implementing the requested fix.

## Validation

Run locally before pushing:

```bash
npm run loop:validate                        # config + schemas + state + workflows
npm run loop:status                          # the current loop state
npm run loop:review -- --pr 42 --dry-run     # what a review would do, no network
git diff --name-only origin/main...HEAD | node .ai/scripts/detect-changed-areas.mjs
```

`tests/unit/ai-loop/` exercises the validators, the state machine and the review
rules through their real entry points as part of `npm test`. Neither OpenAI nor
OpenHands is called by the tests.

The state helper is the only supported way to mutate `.ai/state/`:

```bash
node .ai/scripts/loop-state.mjs set --status implementing --task AI-002-T1
node .ai/scripts/loop-state.mjs next-round --note "round 2 review"
node .ai/scripts/loop-state.mjs log --task AI-002-T1 --pr 42 --round 1 --verdict changes-requested --ci failure
node .ai/scripts/loop-state.mjs reset --note "task merged"
```

## Manual setup still required

1. Add the `ai-review`, `ai-task`, `ai-ready` and `ai-blocked` labels to the
   repository (the loop reads them from `.ai/loop.config.json`).
2. Create the `OPENAI_API_KEY` and `OPENHANDS_API_KEY` secrets (and optionally
   the `OPENHANDS_HOST` and `OPENAI_REVIEW_MODEL` variables).
3. Protect `main`: require the `CI` check and require at least one human review
   before merge. The loop relies on branch protection for its merge gate.
4. Decide who approves task briefs. A brief is only actionable once a human
   flips `humanApproval` to `true` in `.ai/state/task-queue.json`.

## Limitations

- The round counter is derived from the review comments, not from a GitHub
  counter. The comments are the durable record; the state file is a convenience.
- A review of a very large diff is truncated before it reaches the model, and the
  reviewer is told to mark anything it cannot verify as `unverifiable`.
- `dispatch-conversation.mjs` starts an OpenHands conversation and returns its
  id; it does not poll to completion. The conversation appears in the OpenHands
  UI and is linked from the workflow log. The next review round is triggered by
  the fix's push, not by the dispatcher.
- `validate-workflows.mjs` is a structural check (indentation, required keys,
  pinned actions, explicit permissions). GitHub parses the YAML authoritatively
  on push; `node --check` covers the scripts, but no local run replaces the
  GitHub parser.
- The loop does not (and must not) merge. `mergeGate.enabled` stays `false`
  until a human changes it, and even then the merge is a human action.
- **Known pre-existing e2e flake.** `e2e/phase8-6-hardening.spec.ts:213`
  ("a reconnect after missed events recovers the authoritative state") fails
  intermittently on `main` and on unrelated branches; it reproduces on the
  current `main` head with no loop changes applied. It also failed in the last
  `main` push run that GitHub reported as `success`, so the run conclusion is not
  a reliable signal for it. Phase 8.6 is not implemented. Treat a red e2e step
  whose only failure is this spec as a flake: re-run the failed job
  (`gh run rerun <run-id> --failed`) and record the attempt, rather than
  "fixing" product code. Do not change the spec to make it pass as part of loop
  infrastructure work.
