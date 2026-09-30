# <task-id> — <title>

| Field          | Value                                              |
| -------------- | -------------------------------------------------- |
| Task id        | `<task-id>`                                        |
| Phase          | <phase>                                            |
| Status         | proposed                                           |
| Human approval | required (flip `humanApproval` to `true` to queue) |
| Depends on     | <task ids, or "none">                              |

## Summary

<One paragraph: the problem, why it matters, and the intended change.>

## References

- `AGENTS.md`
- `docs/phase-<n>-<name>.md`
- <files the change touches>

## Acceptance criteria

1. <Observable criterion — a command, a test name, an HTTP response or a UI behaviour.>
2. <…>

## Out of scope

- <What must not change.>

## Validation expected

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Notes

<Constraints, risks, or repository quirks the implementer must respect.>
