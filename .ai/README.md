# AI Development Loop

This directory holds the repository-owned configuration, prompts, templates and
machine-readable state for the Badminton AI development loop:

```
ChatGPT architect  →  OpenHands implementation  →  GitHub PR
        ↑                                              ↓
        │                                        GitHub Actions CI
        │                                              ↓
        │                                    external model review
        │                                     (OpenRouter free)
        │                                              ↓
        │                              ┌───────────────┴───────────────┐
        │                           approved                  changes-requested
        │                              │                               │
        │                              ▼                               ▼
        │                       merge gate (auto)               OpenHands fix
        │                              │                    (same PR, CI, re-review)
        │                              ▼                               │
   next-task generation  ◄──────  merge  ◄────────────────────────────┘
                                          (max 3 review rounds)
```

The loop is **infrastructure only**. It never implements product features, never
redesigns the web application and never touches production data. It **does** merge
— through the merge gate, and only when every automated condition passes. Each
stage is a separate, auditable step.

**Roles.** ChatGPT is the architect. The reviewer is an external model — the
loop's default is OpenRouter's free model router (`openrouter/free`), so the
review path needs no paid API. OpenHands is the implementer and the fixer. GitHub
Actions is CI, the orchestrator and the merge gate. The human is an exception
handler for hard stops only. OpenHands never reviews its own work — the review
stage is `.ai/scripts/chatgpt-review.mjs`, not an OpenHands conversation.

## Contents

| Path               | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `loop.config.json` | Single source of truth for the loop's knobs and guardrails     |
| `prompts/`         | The architect / implementation / review / fix agent prompts    |
| `templates/`       | Markdown templates for task briefs and reports                 |
| `schemas/`         | JSON Schemas for the machine-readable state and review reports |
| `state/`           | The loop's durable state, queue and review log                 |
| `scripts/`         | Dependency-free Node validation, state and review helpers      |

## Review stage

`.ai/scripts/chatgpt-review.mjs` is the reviewer. It reads the pull request as
**data**, asks the configured reviewer provider (OpenRouter's free model router
by default) for a strict schema-constrained report, validates it, records it,
posts it as a PR comment, and routes the verdict:

- `approved` + green CI → `ai-ready` (a human still merges);
- `changes-requested` → dispatch OpenHands on the **same** PR and branch;
- `blocked`, or `changes-requested` on round 3 → `ai-blocked`, stop for a human.

`.ai/scripts/wait-for-ci.mjs` runs first so the reviewer never inspects a
half-finished build. `.ai/scripts/review-core.mjs` holds the pure decision rules
(round derivation, head de-duplication, CI classification, verdict coercion) and
is what the tests exercise.

## State files

- `state/loop-state.json` — current round, active task and PR, status, history.
- `state/task-queue.json` — ordered queue of task briefs produced by next-task
  generation. A task is only "ready" when its `id` matches the `currentTaskId`
  in `loop-state.json`.
- `state/review-log.jsonl` — append-only JSON Lines audit trail, one record per
  review round. Never overwritten.

All three are validated by `.github/workflows/ai-loop-validate.yml` on every
change. The schemas are the contract; edit the schema first if the shape must
change.

## Guardrails

- `maxReviewRounds` (default `3`) bounds the review → fix → review cycle. On the
  third unsuccessful review the loop blocks instead of dispatching another fix.
- `mergeGate.enabled` defaults to `false`; a merge requires an explicit human
  decision. Automation only reports readiness.
- `protectedPaths` (production data, CI definitions, secrets) require human
  review and are never edited by the loop automatically.
- Task briefs carry `humanApproval: false`; the loop picks them up automatically.
- A head SHA that a previous review already covered is never reviewed twice.
- No stage reads or writes production data; every stage is a repository-local
  file or GitHub API operation.

## Validation

```bash
npm run loop:validate                        # config + schemas + state + workflows
npm run loop:status                          # print the current loop state
npm run loop:review -- --pr 42 --dry-run     # what a review would do, no network
node .ai/scripts/loop-state.mjs status       # the same, without npm
node .ai/scripts/detect-changed-areas.mjs    # classify changed paths
```

## Required secrets and permissions

See [docs/ai-development-loop.md](../../docs/ai-development-loop.md) for the
required GitHub Secrets, workflow permissions and remaining manual setup.
