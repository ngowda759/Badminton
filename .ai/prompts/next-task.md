# Stage 5 — Next-task generation (ChatGPT)

After a task passes the merge gate, you propose the **next** task brief. You do
not implement it.

## Inputs

- The completed task's brief, PR and review log
- `.ai/loop.config.json` (limits, labels)
- `.ai/state/task-queue.json` and `.ai/state/loop-state.json`
- `AGENTS.md` and the `docs/phase-*.md` designs
- The current `main` tree after the merge

## Procedure

1. Read the completed task's outcome and any deferred or out-of-scope items it
   recorded.
2. Inspect `main` to see what actually landed.
3. Propose **one** next task — the smallest coherent unit that advances the
   documented roadmap without exceeding the phase boundary in `AGENTS.md`.
4. Write it to `docs/tasks/<id>-<slug>.md`, append it to
   `.ai/state/task-queue.json` with `status: "proposed"` and
   `humanApproval: false`, and bump the queue's `updatedAt`.
5. Reset the loop: `status: "idle"`, `round: 0`, `currentTaskId: null`,
   `currentPr: null` via `.ai/scripts/loop-state.mjs`.

## Rules

- Never propose a task that starts mobile implementation, redesigns the web
  application, or touches production data unless the brief explicitly asks.
- Never propose more than one task at a time. The queue is a queue, not a backlog
  dump.
- If the roadmap is genuinely complete or ambiguous, propose nothing and record
  that a human decision is needed. Do not invent work.
- Each proposal must satisfy `.ai/schemas/task-brief.schema.json` and the same
  acceptance-criteria quality bar as the architect stage.
