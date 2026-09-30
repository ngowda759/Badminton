# AI development loop — shared contract

Every stage of the loop (architect, implementation, review, fix, next-task)
inherits this contract. Stage prompts add to it; they never weaken it.

## Roles

| Role         | Actor          | Responsibility                                         |
| ------------ | -------------- | ------------------------------------------------------ |
| Architect    | ChatGPT        | Writes the task brief and the acceptance criteria      |
| Implementer  | OpenHands      | Implements the brief on a branch and opens one PR      |
| CI           | GitHub Actions | Lint, typecheck, test, build, end-to-end               |
| Reviewer     | ChatGPT        | Reviews the diff against the brief; verdict + findings |
| Fixer        | OpenHands      | Fixes review findings on the **same** PR               |
| Orchestrator | GitHub Actions | Waits for CI, runs the review, routes the verdict      |
| Merge gate   | Human          | Decides whether to merge; automation never merges      |

The reviewer and the implementer are **different actors on purpose**. OpenHands
never reviews its own work: it implements, then fixes what ChatGPT reports. A
self-review would be the loop's only authoritative verdict, which is no
verification at all.

## Non-negotiable rules

1. **Repository truth first.** Read `AGENTS.md`, the `docs/phase-*.md` design
   documents and the existing code before proposing or writing anything. The
   repository's conventions win over the prompt.
2. **Scope discipline.** Implement exactly the brief. Do not start mobile
   implementation, do not redesign the web application, do not touch production
   data, do not add unrequested phases or dependencies.
3. **One PR per task.** Fixes go to the same branch and the same PR. Never open
   a second PR for the same task, and never modify or merge an unrelated PR.
4. **No merges.** The loop never merges. `mergeGate.enabled` is `false` until a
   human enables it, and even then the merge is a human action.
5. **Preserve conventions.** Shared packages export TypeScript source with
   explicit `.ts` extensions; strict TypeScript, no `any`, no `@ts-ignore`;
   business logic in services/domain, never in route handlers or components;
   routes never import Prisma.
6. **Evidence over assertion.** Every claim in a report (tests passed, lint
   clean, behaviour verified) must name the command that was run and its result.
   If something was not run, say so explicitly.
7. **Fail loudly.** A blocked stage records the blocker and stops. It never
   silently continues or invents a result.
8. **Secrets.** Never print, log, commit or echo credentials, connection strings,
   SQL errors or stack traces. Only `VITE_`-prefixed variables may reach the
   browser bundle.
9. **Machine-readable state.** Each stage updates `.ai/state/` through
   `.ai/scripts/loop-state.mjs` rather than editing JSON by hand.

## Configuration

All knobs live in `.ai/loop.config.json`: `maxReviewRounds` (default `3`),
`baseBranch`, `protectedPaths`, `requiredChecks`, `limits`, and the label names.
Read them from there; never hard-code a second copy.

## Review → fix cycle

```
CI green? ──no──► fixer (same PR) ──► CI
   │yes
   ▼
reviewer ──changes-requested──► fixer (same PR) ──► CI ──► reviewer (round+1)
   │approved                        (stop at maxReviewRounds)
   ▼
merge gate (human decision)
```

The round counter increments on each review. When `round` reaches
`maxReviewRounds` and findings remain, the loop marks the task `blocked` and
stops for a human instead of looping forever.

The reviewer is **ChatGPT**, driven by `.ai/scripts/chatgpt-review.mjs` from the
`AI loop review` workflow. The fixer is **OpenHands**, dispatched on the same PR
branch. A push from the fixer fires `synchronize`, which runs CI and the next
review round automatically — no manual step sits between a fix and its re-review.
