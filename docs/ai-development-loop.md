# AI development loop

The repository owns a closed, **automatic** development loop:

```
ChatGPT architect  →  OpenHands implementation  →  GitHub PR
        ↑                                              ↓
        │                                        GitHub Actions CI
        │                                              ↓
        │                                 external model review
        │                                  (OpenRouter free router)
        │                                              ↓
        │                              ┌───────────────┴───────────────┐
        │                              │                               │
        │                           approved                  changes-requested
        │                              │                               │
        │                              ▼                               ▼
        │                       merge gate (auto)               OpenHands fix
        │                              │                               │
        │                              ▼                               ▼
        │                          merge → CI ───────────────────────► CI
        │                              │                               │
        │                              │                               ▼
        │                              │                     reviewer re-review
        │                              │                      (round+1, max 3)
        │                              ▼
   next-task generation  ◄────────────┘
```

Every stage is a separate, auditable step. The loop is **infrastructure only**:
it never implements product features, never redesigns the web application and
never touches production data. It **does** merge — but only through the merge
gate, and only when every automated condition passes.

## Who does what

| Actor          | Roles                                                                           |
| -------------- | ------------------------------------------------------------------------------- |
| ChatGPT        | Architect (task briefs)                                                         |
| Reviewer model | **Reviewer** — an external model provider (OpenRouter's free router by default) |
| OpenHands      | Implementer and **fixer**                                                       |
| GitHub Actions | CI, orchestrator and **merge gate**                                             |
| Human          | Exception handler only (hard stops)                                             |

The reviewer and the implementer are different actors **by design**. OpenHands
never reviews its own work: it implements, then fixes what the reviewer reports.
The review stage is not an OpenHands conversation — it is
`.ai/scripts/chatgpt-review.mjs`, driven by the `AI loop review` workflow.

### Reviewer provider

The reviewer is provider-neutral: `review.provider`, `review.endpoint`,
`review.model` and `review.apiKeyEnvVar` in `.ai/loop.config.json` decide which
service the review request is sent to and which credential it reads.

| Setting           | Default                        |
| ----------------- | ------------------------------ |
| Provider          | `openrouter`                   |
| Model             | `openrouter/free`              |
| Endpoint          | `https://openrouter.ai/api/v1` |
| Credential secret | `OPENROUTER_API_KEY`           |

OpenRouter's free model router routes each request to a free model that supports
the features the request needs (here: structured outputs). **Free-tier limit:**
OpenRouter grants free-model access under a **daily request limit** (`GET
/api/v1/key` reports `free_model_daily_requests`). The loop must therefore never
implement an aggressive retry loop — a 429/quota/rate-limit response is an
infrastructure failure that stops the run and waits for a human or the daily
reset. The reviewer script issues exactly one request per review round, and
`.ai/scripts/chatgpt-review.mjs` deliberately has no automatic retry and no paid
fallback provider.

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

Implements exactly that brief on a task branch (`automation/<task-id>-<slug>` by
convention; an implementation may also use `feat/*` or `fix/*`), runs the
repository's validation commands, and opens **one** pull request. It records
`status: ci-running` and the PR in `.ai/state/loop-state.json`.

The branch name is a convenience, not the loop's identity: a task is recognised
by the loop's own records, so an implementation is free to use a descriptive
branch without breaking progression (see "How an AI-managed pull request is
identified").

### 3. CI — GitHub Actions

The existing `CI` workflow (`.github/workflows/ci.yml`) is unchanged: lint,
typecheck, unit/integration tests, migrations, seed, build, and Playwright
end-to-end tests. The required check name comes from `requiredChecks` in
`.ai/loop.config.json`.

### 4. Review — external reviewer model (automatic)

`ai-loop-review.yml` is triggered by the `CI` workflow completing
(`workflow_run`), waits for the required checks to finish
(`.ai/scripts/wait-for-ci.mjs`), then runs `.ai/scripts/chatgpt-review.mjs`:

1. reads the PR (title, body, diff, checks, existing comments) as **data**;
2. derives the round and refuses to review a head SHA it has already reviewed;
3. asks the configured reviewer provider (OpenRouter's free Responses endpoint)
   for a strict, schema-constrained report;
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

### 6. Merge gate — automatic

`ai-loop-merge-gate.yml` runs after the review. It re-derives **every** condition
at merge time rather than trusting the earlier review — a push or a label change
between approval and merge would otherwise be merged on stale evidence:

- the pull request is open, targets `main`, is not a fork, and is an AI-managed
  task (see "How an AI-managed pull request is identified");
- the latest review verdict is `approved` **and** it records the current head
  commit (`headMatchesApproval`);
- every required check is green (`requiredChecks` in `.ai/loop.config.json`);
- the pull request is mergeable;
- no protected path or credential file changed.

When all of that holds it arms GitHub's **native auto-merge**, so the merge
happens through the protected path and respects branch protection rather than
racing it. A protected-path or credential change exits `3` (a human must merge);
any other failure exits `1` and the loop stops.

### 7. Next task — automatic

`ai-loop-next-task.yml` fires on three events, all handled by the trusted
`advance-after-merge.mjs` from the base branch. The merge reconciliation itself
is a single function in that script, so every trigger reuses the _same_
task-attribution, idempotency and state-transition rules rather than a second
implementation:

- **`pull_request: closed`** — the normal path. The workflow itself only applies
  a coarse filter (targets `main`, same repository); the decision is made by
  `advance-after-merge.mjs`, which writes a `managed=true|false` output. When the
  closed pull request is AI-managed and merged, the script records the task
  `done`, carries the reviewer's final findings onto the task, walks the loop
  `ready-to-merge → merging → completed → next-task`, and the workflow dispatches
  the architect conversation. `ai-loop-implement.yml` then fires on the
  `task-queue.json` push and dispatches the implementation — no human step sits
  between a merge and the next task.
- **`push` to `.ai/state/loop-state.json`** — a recovery check. If the state is
  already a legitimate `next-task` state with **no active task and no pull
  request** (a merge whose architect dispatch never ran, so the loop stalled),
  the script reports `managed=true` and the architect is dispatched. It never
  creates a task, never advances a merge and never touches a pull request. Only
  `loop-state.json` is watched: a `task-queue.json` push is the architect's own
  output and belongs to `ai-loop-implement.yml`, so watching it here would
  dispatch the architect twice.
- **`workflow_dispatch`** — operator recovery for a loop that stalled with a
  merge it never reconciled. The `pull_request: closed` delivery that should have
  advanced the loop may have been missed (or the state on the base branch was
  never advanced), leaving a merged task still recorded as open. The script
  **discovers** the already-merged AI pull request that completes a task its own
  records still show as open and reconciles it through the _same_ merge logic as
  the normal path — task → `done`, `ready-to-merge → merging → completed →
next-task` — then dispatches the architect. It never hard-codes a task id,
  never invents a task, and never attributes an `[AI-INFRA]` or unrelated merge.
  Running it again over an already-consistent state (or with the next task
  already queued) reports `managed=false`, so it cannot re-complete a task or
  generate a duplicate next task.

Discovery is `selectMergedTaskPr` in `.ai/scripts/loop-core.mjs`: it lists the
recently merged pull requests, keeps only those that are AI-managed, attributes
each through `classifyMergedLoopPr`, and returns the first whose task is still
recorded as open (not `done`). A merged task already recorded `done` is skipped,
which is what makes the recovery idempotent.

An unrelated pull request closing is a no-op. A pull request that is AI-managed
but closed **without** merging is a hard stop (`merge-conflict`): the loop must
not silently generate the next task when its own pull request was abandoned.
A duplicate `pull_request: closed` delivery is idempotent — the task is already
`done`, so the script reports `managed=false` and generates nothing twice.

A merged AI-managed pull request that is **not** a queued task is classified
before it can stop the loop. Loop infrastructure (`[AI-INFRA]` tooling — a
reviewer fix, a workflow hardening) is never in the task queue, so attributing it
to a task would invent a completion and lose history; it reconciles to a no-op
(`managed=false`) and the loop carries on with the task actually in flight. This
is what keeps an infrastructure merge from hard-stopping the loop as
`state-corruption` when it happens while a task is open. Any _other_ AI-managed
merge that names no queued task is genuine corruption and still hard-stops —
the exemption is deliberately narrow, and no task is ever invented.

`assertSingleActiveTask` treats `next-task` as an **inactive** state (like `idle`
and `completed`): it deliberately holds no active task and no open automation
pull request, so the concurrency guard must not demand one there. The active
implementation statuses (`architecting`, `implementing`, `ci-running`,
`reviewing`, `fixing`, `ready-to-merge`, `merging`) still require their active
task/PR record.

### 8. Next-task generation — ChatGPT

Proposes exactly one next task, appends it with `status: "approved"` and
`humanApproval: false`, and stops. The queue change fires `ai-loop-implement.yml`,
which dispatches the implementation. The loop is not reset to `idle`: it moves to
`next-task` and then to `implementing`, so the round counter and the task
association are never lost.

## How an AI-managed pull request is identified

A branch name is a convention, not an identity. The loop's tasks have
legitimately lived on `automation/*` and on descriptive branches such as
`feat/tournament-progression`, so **no** stage may treat "AI task" as
"`automation/*`". The single authoritative test is
`isAiManagedPullRequest` in `.ai/scripts/loop-core.mjs`, used by the merge gate,
the review resolver and the next-task advance alike. A pull request is
AI-managed when it targets the base branch and is not a fork, **and** any of:

1. its head branch uses the loop's `branchPrefix` (`automation/`) — the original
   convention;
2. any task in `.ai/state/task-queue.json` records its number or branch as that
   task's implementation — the queue keeps that record after the state moves on;
3. it carries the loop's `automation.triggerLabel` (`ai-task`);
4. its head commit (or merge commit) is covered by a trusted review marker
   (`<!-- ai-loop-review round=<n> head=<sha> verdict=<v> -->`), which only the
   loop's own reviewer writes;
5. its title or head branch names a task id present in `.ai/state/task-queue.json`;
6. it is the loop's recorded active pull request (`state.currentPr`) — this
   matches on the PR number, so the classification still holds after the branch
   is deleted.

`advance-after-merge.mjs` runs this test from the trusted base branch and writes
`managed=true|false` to `GITHUB_OUTPUT`; `ai-loop-next-task.yml` gates the
enforce-single and architect-dispatch steps on that output. Keeping the rules in
one reviewed script — rather than in a GitHub expression — means an AI task on
`feat/*` advances the loop exactly like one on `automation/*`, while an unrelated
pull request (no label, no marker, no queued task id, not the recorded active PR)
is a no-op and cannot start the generator.

## The review round limit

`maxReviewRounds` defaults to `3`. The round increments on each review; when it
reaches the limit with **blocking** findings still open, the loop applies
`ai-blocked`, records `hard stop: max-rounds-exceeded` and stops for a human
instead of looping forever. It does not dispatch another fix at that point. A
limit reached with only advisory (`minor`/`nit`) findings left is not a hard
stop.

## Anti-storm protection

A review costs money and time, so a duplicate trigger must be a no-op:

- the review resolves its pull request through `.ai/scripts/resolve-review-pr.mjs`
  and acts only on an open, same-repository pull request that is AI-managed (see
  "How an AI-managed pull request is identified") — unrelated pull requests are
  ignored;
- the reviewer refuses to review a head SHA that any previous review comment
  already covers, which holds even when the state file is stale;
- one run per pull request at a time (`concurrency`, `cancel-in-progress: false`),
  so a re-run never races an in-flight review.

## State machine

`loop-state.mjs set --status` enforces the loop's transitions:

```
completed → next-task → implementing → ci-running → reviewing
                                   ↑                    │
                                   │        ┌───────────┴───────────┐
                                   │        │                       │
                                   │   ready-to-merge          fixing → ci-running
                                   │        │                       │
                                   │      merging              reviewing (round+1)
                                   │        │
                                   └── completed ←────────────┘

blocked / human-review-required  ←  (any state)
```

`blocked` and `human-review-required` are reachable from anywhere, because a stage
that cannot proceed must always be able to stop for a human. An illegal step is
refused unless `--force` is passed, and a forced step is recorded in the history
like any legal one.

## Guardrails encoded in the repository

- `protectedPaths` in `.ai/loop.config.json` (`prisma/migrations/**`,
  `prisma/seed.ts`, `.github/workflows/ci.yml`, `.env`, `.env.*`) are flagged by
  `detect-changed-areas.mjs` **and** re-checked at review and merge time. A
  protected-path or credential change is a hard stop: the loop never merges it.
- `limits.maxChangedFiles` / `limits.maxDiffLines` bound a single change.
- `maxConcurrentTasks` is `1`: the validator fails the loop if two tasks are
  active, if two tasks are waiting to be implemented, or if a task is out of
  sequence. `loop-tasks.mjs start` refuses a second implementation directly.
- `mergeGate.requireHumanApproval` must be `false` while `automation.enabled` is
  `true`, and `automation.autoMerge` requires `mergeGate.enabled`,
  `requireCiGreen` and `requireReviewPassed` — the validator refuses a config that
  contradicts the autonomous architecture.
- `.ai/state/review-log.jsonl` is append-only and schema-validated. A review is
  never overwritten.
- The trusted workflows are guarded by `assert-trusted-review.mjs`, which fails
  if a `workflow_run` job checks out PR-controlled code, installs or runs it,
  drops `persist-credentials: false`, or gains `contents: write`.

## Workflows

| Workflow                 | Trigger                                                                              | Purpose                                                               |
| ------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `ci.yml`                 | PR / push to `main`                                                                  | Unchanged product CI                                                  |
| `ai-loop-validate.yml`   | PR / push to `main` (paths `.ai/**`, `.github/workflows/**`, docs, skill)            | Validate config, state, schemas and workflow structure                |
| `ai-loop-review.yml`     | `workflow_run` after `CI`, or manual                                                 | Wait for CI, run the review, route the verdict                        |
| `ai-loop-merge-gate.yml` | `workflow_run` after the review, or manual                                           | Re-check every gate, then merge (or stop for a human)                 |
| `ai-loop-next-task.yml`  | PR `closed` (AI-managed PR), push to `.ai/state/loop-state.json`, or manual recovery | Reconcile a merge (or recover a stalled loop), dispatch the architect |
| `ai-loop-implement.yml`  | push to `main` touching `.ai/state/task-queue.json`, or manual recovery              | Dispatch the implementation conversation                              |

The two `workflow_run` workflows are the loop's most privileged and are
deliberately separated from the pull request's own workflows: they run with the
base repository's token and secrets, check out **only** the default branch, and
never install or execute pull-request-controlled code.

### Bootstrap: the first merge must be manual

`workflow_run` only fires for a workflow that already exists on the **default
branch**, and `ai-loop-next-task.yml` only fires for a `pull_request` event that
GitHub can dispatch from the default branch's copy of that file. Neither is true
while the loop's own pull request is still open, so on the pull request that
introduces the loop:

- `ai-loop-review.yml` and `ai-loop-merge-gate.yml` do not start automatically
  after `CI`, even though CI itself runs;
- `ai-loop-merge-gate.yml` can still be run by hand
  (`workflow_dispatch`, `pr_number`) — but only once the file is on the default
  branch, so it is not a usable bootstrap path either.

This is a GitHub platform constraint, not a defect in the loop. The consequence
is that **the AI-001 infrastructure pull request is merged by a human**; from the
next task onward the loop is self-driving. If the merge gate has to be exercised
by hand for the first merge, that is the expected sequence, not a broken loop.

Two follow-on checks after the first manual merge confirm the loop came up:

1. `main` now holds the `ai-loop-*` workflows, so the next AI-managed pull
   request (on `automation/*`, `feat/*`, `fix/*` or any task branch) gets an
   automatic review and merge gate.
2. The `pull_request: closed` trigger fires on that merge and
   `ai-loop-next-task.yml` dispatches the architect, so the queue change starts
   the next implementation.

If the merge happened before `ai-loop-next-task.yml` reached `main`, the state is
left in `next-task` with no dispatch. The workflow's **push** trigger now covers
exactly that: a commit that moves `.ai/state/loop-state.json` into a recoverable
`next-task` state (no active task, no active PR) restarts the architect. To repair
the bookkeeping by hand, use the state helper — never edit the JSON directly:

```bash
node .ai/scripts/loop-state.mjs recover --note "stale state repaired"
```

`recover` clears the recorded task and pull request and sets `next-task`; it is
refused from an active status, and it never creates a task. If the loop instead
stalled with a merge it never reconciled — a task still recorded as `approved`
while its pull request has already merged — run `ai-loop-next-task.yml` by hand
with `workflow_dispatch` (`reason`). That path discovers the merged AI task and
reconciles it through the same merge-transition logic as the normal path (task →
`done`, `ready-to-merge → merging → completed → next-task`) before dispatching
the architect, so the architect never receives contradictory context. It never
hard-codes a task id, and running it again is a no-op.

## Required GitHub Secrets

Configure these under **Settings → Secrets and variables → Actions**:

| Name                      | Kind     | Required | Purpose                                                          |
| ------------------------- | -------- | -------- | ---------------------------------------------------------------- |
| `OPENROUTER_API_KEY`      | Secret   | Yes      | Reviewer credential (OpenRouter free model router)               |
| `OPENHANDS_API_KEY`       | Secret   | Yes      | Bearer token used to start OpenHands conversations               |
| `OPENHANDS_HOST`          | Variable | No       | OpenHands API base URL (defaults to `https://app.all-hands.dev`) |
| `OPENROUTER_REVIEW_MODEL` | Variable | No       | Review model override (defaults to `review.model` in the config) |

`GITHUB_TOKEN` is provided automatically by GitHub Actions and needs no
configuration. No database, Supabase or production credential is required by any
loop workflow — the loop never touches production data. The paid `OPENAI_API_KEY`
is **not** required on the normal review path.

The review workflow derives the required credential from
`review.apiKeyEnvVar` in `.ai/loop.config.json` (currently `OPENROUTER_API_KEY`)
and injects the matching secret, so a missing `OPENROUTER_API_KEY` fails the job
with a clear infrastructure/credential error (`::error::OPENROUTER_API_KEY is not
configured`) and a step-summary message. The workflow never falls back to OpenAI
or any other provider. If `OPENHANDS_API_KEY` is absent, the fix dispatch prints a
skip message and exits `0`, so the review still publishes its findings. The CI
workflow itself needs no secret at all.

## Required permissions

- `ai-loop-validate.yml`: `contents: read`.
- `ai-loop-implement.yml`: `contents: read`, `pull-requests: read`.
- `ai-loop-review.yml`: `contents: read`, `checks: read`,
  `pull-requests: write`, `issues: write` — enough to read the PR and its checks
  and to post the review comment and labels, and nothing more. **No
  `contents: write`**: the review stage cannot push or merge.
- `ai-loop-merge-gate.yml`: `contents: write`, `checks: read`,
  `pull-requests: write` — the minimum a merge needs, and the only workflow in
  the loop that can merge.
- `ai-loop-next-task.yml`: `contents: read`, `pull-requests: read`,
  `issues: write`.

Only the merge gate can write. The review, next-task and implement workflows
cannot push or merge, and `assert-trusted-review.mjs` fails the build if one of
them gains `contents: write`.

## Security

The review and merge-gate workflows are triggered by `workflow_run`, so they run
with the **base repository's** token and secrets even when the pull request came
from a fork. That is deliberate — it is what lets them post a review and merge —
and it is why both are held to a strict model:

- they check out the **default branch only**, with an explicit
  `ref: ${{ github.event.repository.default_branch }}` and
  `persist-credentials: false`;
- they never run `npm ci`/`npm install`/`npm run`, never `source` a repository
  file, and never touch `node_modules`;
- the pull request is read as **data** through `gh pr view` / `gh pr diff` /
  `gh pr checks` and passed to the model as text;
- a cross-repository (fork) pull request is refused rather than reviewed;
- `.ai/scripts/assert-trusted-review.mjs` enforces all of the above and runs in
  the validation workflow and in both trusted workflows, so a regression fails
  the build instead of shipping a privilege-escalation bug.

`ci.yml` is deliberately **not** a `workflow_run` trigger, so a pull request
cannot reach the privileged workflows by editing the CI workflow. The OpenHands
implement/fix stages are different on purpose — OpenHands is authenticated to the
repository branch and is responsible for implementing the requested change.

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

The loop is autonomous once these one-time settings exist:

1. Add the `ai-review`, `ai-task`, `ai-ready` and `ai-blocked` labels to the
   repository (the loop reads them from `.ai/loop.config.json`).
2. Create the `OPENROUTER_API_KEY` and `OPENHANDS_API_KEY` secrets (and
   optionally the `OPENHANDS_HOST` and `OPENROUTER_REVIEW_MODEL` variables).
3. Protect `main` and require the `CI` check. Because the merge gate uses
   GitHub's **native auto-merge**, branch protection is honoured: the merge waits
   for the required checks rather than bypassing them. If you also require a human
   review, the auto-merge will wait for it — that is a policy choice, not a loop
   requirement.
4. Enable auto-merge on the repository
   (Settings → General → _Allow auto-merge_) if you want the gate to arm native
   auto-merge. Without it the gate falls back to an explicit `gh pr merge`, which
   still refuses a non-mergeable pull request.
5. Create the task queue's first entry, or let the architect generate it. No
   human approval of a brief is required — `humanApproval` is always `false`.

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
- The merge gate's fallback path (an explicit `gh pr merge` when native
  auto-merge is unavailable) merges immediately when the pull request is already
  mergeable; the native path is preferred because it goes through branch
  protection. If you require a human review on `main`, only the native path can
  satisfy it — do not disable auto-merge on the repository in that case.
- `resolve-review-pr.mjs` resolves the pull request from the `workflow_run`
  event, the head branch or the manual input. A `workflow_run` on a fork has no
  pull request number, so a fork contribution is only reviewed when its branch
  uses the loop prefix — which is intentional.
- The architect and next-task stages call the OpenHands Cloud API
  (`dispatch-conversation.mjs`); the review stage calls the configured reviewer
  provider's Responses API (OpenRouter's free router by default) through
  `chatgpt-review.mjs`. The loop cannot run without the OpenHands and reviewer
  credentials.
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
