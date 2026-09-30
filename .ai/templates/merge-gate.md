# Merge gate — <task-id> / PR #<n>

The loop never merges. This checklist is the human decision point.

| Gate                        | Required | Status |
| --------------------------- | -------- | ------ |
| CI green on the head SHA    | yes      | <…>    |
| Review verdict `approved`   | yes      | <…>    |
| All acceptance criteria met | yes      | <…>    |
| No protected path modified  | yes      | <…>    |
| No unrelated PR touched     | yes      | <…>    |
| Human approval              | yes      | <…>    |

## Decision

- [ ] Merge (human action)
- [ ] Return for another fix round (rounds remaining: <n>)
- [ ] Block and escalate

## Notes

<Anything the human needs to know before deciding.>

---

This summary was produced by an AI agent (OpenHands) on behalf of the user.
