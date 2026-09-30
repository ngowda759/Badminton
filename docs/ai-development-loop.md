# AI development loop

The repository owns a closed development loop:

```
ChatGPT architect  →  OpenHands implementation  →  GitHub PR
        ↑                                              ↓
        │                                        GitHub Actions CI
        │                                              ↓
   next-task generation  ←  merge gate  ←  ChatGPT review
                                    ↑            ↓
                                    └── OpenHands fixes same PR
                                        (MAX_REVIEW_ROUNDS = 3)
```

Every stage is a separate, auditable step. The loop is **infrastructure only**:
it never implements product features, never redesigns the web application, never
touches production data, and never merges a pull request.

## Where things live

| Path                                       | Purpose                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `.ai/loop.config.json`                     | Loop knobs and guardrails (single source of truth)                        |
| `.ai/prompts/`                             | Stage prompts (system, architect, implementation, review, fix, next-task) |
| `.ai/schemas/`                             | JSON Schemas for config, state, task briefs and reviews                   |
| `.ai/state/`                               | Durable state, task queue and the append-only review log                  |
| `.ai/scripts/`                             | Dependency-free validation and state helpers                              |
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
end-to-end tests.

### 4. Review — ChatGPT

Reviews the diff against the brief and the repository conventions, then emits a
review report (`changes-requested` / `approved` / `blocked`) with findings that
name a file, a line and evidence. The round counter increments.

### 5. Fix — OpenHands

Fixes the findings on the **same** PR branch, re-validates, replies to each
thread with the fixing commit (or the reason for declining), and pushes. It never
opens a second PR.

### 6. Merge gate — human

`mergeGate.enabled` is `false`: automation only reports readiness. The human
checks CI, the review verdict, the acceptance criteria, protected paths and the
change size, then merges — or returns the PR for another round, or blocks it.

### 7. Next-task generation — ChatGPT

Proposes exactly one next task and resets the loop to `idle` / round `0`.

## The review round limit

`maxReviewRounds` defaults to `3`. The round increments on each review; when it
reaches the limit with findings still open, the loop marks the task `blocked`
and stops for a human instead of looping forever.

## Guardrails encoded in the repository

- `protectedPaths` in `.ai/loop.config.json` (`prisma/migrations/**`,
  `prisma/seed.ts`, `.github/workflows/ci.yml`, `.env`, `.env.*`) are flagged by
  `detect-changed-areas.mjs` and require human review.
- `limits.maxChangedFiles` / `limits.maxDiffLines` bound a single change.
- A task with `humanApproval: false` is never picked up; the validator fails the
  loop if an unapproved task becomes active.
- `.ai/state/review-log.jsonl` is append-only and schema-validated.

## Workflows

| Workflow                 | Trigger                                                                   | Purpose                                                  |
| ------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `ci.yml`                 | PR / push to `main`                                                       | Unchanged product CI                                     |
| `ai-loop-validate.yml`   | PR / push to `main` (paths `.ai/**`, `.github/workflows/**`, docs, skill) | Validate config, state, schemas and workflow structure   |
| `ai-loop-implement.yml`  | manual (`task_id`)                                                        | Dispatch one OpenHands implementation conversation       |
| `ai-loop-review.yml`     | `pull_request` labeled `ai-review`, or manual                             | Dispatch one OpenHands review conversation               |
| `ai-loop-merge-gate.yml` | PR activity, or manual                                                    | Report merge readiness (never merges)                    |
| `ai-loop-next-task.yml`  | manual                                                                    | Dispatch the next-task conversation after the merge gate |

## Required GitHub Secrets

Configure these under **Settings → Secrets and variables → Actions**:

| Name                | Kind     | Required | Purpose                                                          |
| ------------------- | -------- | -------- | ---------------------------------------------------------------- |
| `OPENHANDS_API_KEY` | Secret   | Yes      | Bearer token used to start OpenHands conversations               |
| `OPENHANDS_HOST`    | Variable | No       | OpenHands API base URL (defaults to `https://app.all-hands.dev`) |

`GITHUB_TOKEN` is provided automatically by GitHub Actions and needs no
configuration. No database, Supabase or production credential is required by any
loop workflow — the loop never touches production data.

If `OPENHANDS_API_KEY` is absent, `dispatch-conversation.mjs` prints a skip
message and exits `0`, so the workflows are safe to merge before the secret
exists. The CI workflow itself needs no secret at all.

## Required permissions

- `ai-loop-validate.yml`: `contents: read`.
- `ai-loop-implement.yml`: `contents: read`.
- `ai-loop-review.yml`: `contents: read`. (The `pull_request` event's default
  `GITHUB_TOKEN` is read-only; `gh pr view` needs no more.)
- `ai-loop-merge-gate.yml`: `contents: read`, `checks: read`,
  `pull-requests: read`.
- `ai-loop-next-task.yml`: `contents: read`.

No workflow requests `contents: write`, `pull-requests: write` or any other
write scope. Nothing in the loop can push, label or merge by itself — those are
OpenHands conversation actions performed with the user's own credentials, under
the human's review.

## Validation

Run locally before pushing:

```bash
npm run loop:validate                        # config + schemas + state + workflows
npm run loop:status                          # the current loop state
git diff --name-only origin/main...HEAD | node .ai/scripts/detect-changed-areas.mjs
```

`tests/unit/ai-loop/loop-scripts.test.ts` exercises the validators and the
state helper through their real entry points as part of `npm test`.

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
2. Create the `OPENHANDS_API_KEY` secret (and optionally the `OPENHANDS_HOST`
   variable).
3. Protect `main`: require the `CI` check and require at least one human review
   before merge. The loop relies on branch protection for its merge gate.
4. Decide who approves task briefs. A brief is only actionable once a human
   flips `humanApproval` to `true` in `.ai/state/task-queue.json`.

## Limitations

- The round counter is advanced manually (or by the review conversation). GitHub
  Actions does not itself count rounds; the state file is the record.
- `ai-loop-review.yml` fires on the `ai-review` label. Re-reviewing the same PR
  requires a manual dispatch, which is intentional: it prevents a review storm.
- The dispatch script starts a conversation and returns its id; it does not poll
  to completion. The conversation appears in the OpenHands UI and is linked from
  the workflow log.
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
