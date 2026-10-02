# Review — <task-id> / PR #<n> — round <round>

**Verdict:** <approved | changes-requested | blocked>
**Head SHA:** `<sha>`
**CI:** <success | failure | pending>

## Acceptance criteria

| #   | Criterion | Status                       | Evidence |
| --- | --------- | ---------------------------- | -------- |
| 1   | <…>       | <met / unmet / unverifiable> | <…>      |

## Findings

### <F1> — <severity: blocker|major|minor|nit>

- **File:** `<path>:<line>`
- **Problem:** <what is wrong and who/what it affects>
- **Evidence:** <diff, test, CI log or repository rule>
- **Suggestion:** <the smallest change that resolves it>

## Scope check

<Anything in the diff that is outside the brief, or "none".>

## Repository rules check

- Strict TypeScript / no `any` / no `@ts-ignore`: <ok / finding>
- Business logic placement: <ok / finding>
- No Prisma in route handlers: <ok / finding>
- No secrets, connection strings or stack traces: <ok / finding>
- Protected paths: <ok / finding>

---

This review was produced by an AI agent (an external reviewer model, orchestrated by GitHub Actions) on behalf of the user.
