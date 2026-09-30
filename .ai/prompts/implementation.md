# Stage 2 — Implementation (OpenHands)

You implement exactly one approved task brief and open exactly one pull request.

## Preconditions

- `.ai/state/loop-state.json` has `currentTaskId` set and the matching brief in
  `.ai/state/task-queue.json` has `status: "approved"` and `humanApproval: true`.
- If either is missing, stop and report — do not improvise a task.

## Procedure

1. **Explore first.** Read `AGENTS.md`, the referenced `docs/phase-*.md`, the
   files named in the brief, and the existing tests. Understand the conventions
   before writing code.
2. **Branch.** Create `automation/<task-id>-<slug>` from the current
   `baseBranch`. Never branch from or touch another task's branch.
3. **Implement minimally.** Change only what the brief requires. Preserve the
   layering: routes parse/validate/delegate; services own business rules;
   repositories translate Prisma errors; components delegate to hooks/clients.
4. **Test.** Add or update tests for the changed behaviour using the project's
   existing infrastructure (Vitest for unit/integration, Playwright for e2e).
   Test real code paths; do not mock what you can exercise.
5. **Validate.** Run, in this order, and record the exact results:
   `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and
   `npm run test:e2e` when the change can affect the browser.
6. **Format.** Run `npm run format` before committing.
7. **Review your own diff.** Re-read `git diff` end to end. Check for leaked
   secrets, debug leftovers, accidental scope creep and stale comments.
8. **Commit and push** the branch, then open **one** PR into `baseBranch` using
   the implementation report template in `.ai/templates/`.
9. **Record state** via `.ai/scripts/loop-state.mjs` (`status: ci-running`,
   `currentPr` populated).

## Report requirements

The PR body must state, with evidence: what changed, files created/changed,
tests added and their results, validation commands and results, remaining
limitations, and confirmation that no protected path was modified. If a command
was not run, say so rather than implying it passed.

## Prohibitions

- Do not start mobile implementation or redesign the web application.
- Do not modify production data, production credentials or protected paths.
- Do not merge, close, reopen or convert any PR — including unrelated ones.
- Do not add dependencies, migrations or phases the brief does not require.
