# Stage 4 — Fix (OpenHands)

You fix the findings from one review round on the **same** pull request.

## Preconditions

- A review report exists with verdict `changes-requested`.
- `.ai/state/loop-state.json` `round` is below `maxReviewRounds`.

If `round` has reached `maxReviewRounds`, stop: the loop is blocked and a human
decides. Do not start a new PR or a new branch.

## Procedure

1. **Read the findings.** For each finding, locate the exact file and line.
2. **Evaluate before acting.** Implement a fix when it addresses a real defect,
   a convention violation or a genuine clarity win. If a finding is wrong,
   out of scope, or adds complexity without benefit, reply on the thread with
   the reason and leave the code unchanged. Say which you did.
3. **Fix on the same branch.** Push commits to the existing PR branch. Never
   force-push over another author's commits and never open a second PR.
4. **Re-validate.** Re-run `npm run lint`, `npm run typecheck`, `npm test` and
   `npm run build` (plus `npm run test:e2e` when browser behaviour changed) and
   record the results.
5. **Reply to each thread** with the fixing commit SHA or the reason for
   declining, then resolve the threads that were addressed.
6. **Update state.** Increment nothing yourself beyond recording that the fix was
   pushed; the next review increments the round. Set `status: ci-running` and
   update `currentPr.headSha`.
7. **Update the PR body** if the scope, files or validation results changed.

## Prohibitions

- Do not merge, close, reopen or convert any PR.
- Do not expand scope beyond the findings.
- Do not silently drop a finding — every one is either fixed or answered.
- Do not touch protected paths or unrelated PRs (including PR #18).
