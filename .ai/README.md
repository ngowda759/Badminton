# AI Development Loop

This directory holds the repository-owned configuration, prompts, templates and
machine-readable state for the Badminton AI development loop:

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

The loop is **infrastructure only**. It never implements product features, never
redesigns the web application, never touches production data and never merges a
pull request on its own. Each stage is a separate, auditable step.

## Contents

| Path               | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `loop.config.json` | Single source of truth for the loop's knobs and guardrails     |
| `prompts/`         | The architect / implementation / review / fix agent prompts    |
| `templates/`       | Markdown templates for task briefs and reports                 |
| `schemas/`         | JSON Schemas for the machine-readable state and review reports |
| `state/`           | The loop's durable state, queue and review log                 |
| `scripts/`         | Dependency-free Node validation and state helpers              |

## State files

- `state/loop-state.json` — current round, active task and PR, status, history.
- `state/task-queue.json` — ordered queue of task briefs produced by next-task
  generation. A task is only "ready" when its `id` matches the `currentTaskId`
  in `loop-state.json`.
- `state/review-log.jsonl` — append-only JSON Lines audit trail, one record per
  review round.

All three are validated by `.github/workflows/ai-loop-validate.yml` on every
change. The schemas are the contract; edit the schema first if the shape must
change.

## Guardrails

- `maxReviewRounds` (default `3`) bounds the review → fix → review cycle.
- `mergeGate.enabled` defaults to `false`; a merge requires an explicit human
  decision. Automation only reports readiness.
- `protectedPaths` (production data, CI definitions, secrets) require human
  review and are never edited by the loop automatically.
- Task briefs must declare `humanApproval: true` before the loop picks them up.
- No stage reads or writes production data; every stage is a repository-local
  file or GitHub API operation.

## Validation

```bash
npm run loop:validate                        # config + schemas + state + workflows
npm run loop:status                          # print the current loop state
node .ai/scripts/loop-state.mjs status       # the same, without npm
node .ai/scripts/detect-changed-areas.mjs    # classify changed paths
```

## Required secrets and permissions

See [docs/ai-development-loop.md](../../docs/ai-development-loop.md) for the
required GitHub Secrets, workflow permissions and remaining manual setup.
