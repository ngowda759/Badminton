# Merge gate — <task-id> / PR #<n>

`ai-loop-merge-gate.yml` re-derives every condition below at merge time from
GitHub. Nothing here is copied from the earlier review: a push or a label change
between the approval and the merge would otherwise be merged on stale evidence.

| Gate                                     | Source                         | Status |
| ---------------------------------------- | ------------------------------ | ------ |
| PR open, targets `main`, same repository | `gh pr view`                   | <…>    |
| PR is AI-managed (`isAiManagedPullRequest`) | loop state, label, marker, task id, branch prefix | <…> |
| Latest review verdict `approved`         | review marker on the PR        | <…>    |
| Approval covers the current head commit  | marker `head=` vs `headRefOid` | <…>    |
| Required CI green (`requiredChecks`)     | `gh pr checks`                 | <…>    |
| PR mergeable (no conflicts)              | `gh pr view`                   | <…>    |
| No protected path or credential file     | `gh pr view --json files`      | <…>    |

## Decision

- **All gates pass** → arm GitHub native auto-merge (`squash`); the merge goes
  through branch protection.
- **Protected path or credential change** → exit `3`; a human merges if correct.
- **Any other gate fails** → exit `1`; the loop stops and the reason is recorded
  in `loop-state.json` (`blockedReason`).

## Notes

<Anything that affected the decision.>

---

This summary was produced by an AI agent (OpenHands) on behalf of the user.
