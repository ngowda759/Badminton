---
name: badminton-development
description: Develop, test and validate changes in the Badminton V2 tournament platform monorepo. Use when implementing or reviewing changes in this repository — it records the layering rules, commands, strict-TypeScript conventions, realtime/outbox invariants and CI expectations that every change must respect.
triggers:
  - badminton
  - tournament
  - phase
---

# Badminton V2 development

Badminton V2 is a typed full-stack monorepo (npm workspaces): a Fastify API, a
React 19 web app, and shared packages. `AGENTS.md` is the authoritative
repository guidance; `docs/phase-*.md` are the authoritative designs. Read them
before changing anything.

## Layout and layering

Each layer depends only on the layer below it. A route handler never touches
Prisma; a React component never talks to the database.

```
React / Vite  (apps/web)
      |
Fastify API   (apps/api/src/http — routes, validation, error mapping)
      |
Application services  (packages/application)
      |
Domain rules  (packages/domain)
      |
Repository ports  (packages/application)
      |
Prisma infrastructure  (packages/infrastructure)
      |
PostgreSQL
```

- `apps/api` — `app.ts` is the factory, `server.ts` owns `listen`.
  `src/http/` routes, helpers and the `ApiServices` interface; `src/http/sse/`
  the SSE codec and connection adapter; `src/errors/` the error model and HTTP
  mapper; `src/composition/` wires Prisma repositories into services.
- `apps/web` — React 19 + Vite + Tailwind v4 + shadcn/ui. Components delegate to
  hooks/clients in `lib/`.
- `packages/domain` — pure types, lifecycle tables, normalization, dates, errors.
  No runtime dependencies.
- `packages/validation` — shared Zod schemas and `parseRequest`.
- `packages/application` — services, repository ports, the `UnitOfWork` port.
- `packages/infrastructure` — Prisma adapters and Prisma-error translation.
- `packages/database` — Prisma client lifecycle, `DatabaseProbe`, health check.
- `packages/config` — `.env` loading and Zod-validated config.
- `prisma/` — schema, migrations, idempotent seed.

## Hard rules

1. **Strict TypeScript.** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
   `verbatimModuleSyntax`. No `any`, no `@ts-ignore`. Unused variables are
   prefixed `_`.
2. **Shared packages export TypeScript source** (`"exports": "./src/index.ts"`)
   and imports use explicit `.ts` extensions.
3. **Business logic never lives in route handlers or React components.** Routes
   delegate to services; components delegate to hooks/clients.
4. **Route handlers must not import Prisma.** Go through `packages/database` ports.
5. **Services depend only on repository ports** and never import Prisma, Fastify
   or HTTP types.
6. **Transactions are opt-in.** Use a plain `RepositoryClient` for reads and
   single writes; receive `UnitOfWork` only when the service owns a multi-row
   atomic operation. Cover the boundary with
   `tests/unit/application/transaction-boundaries.test.ts`.
7. **Repositories translate known Prisma constraint failures into
   `@badminton/domain` errors.** Never leak SQL, constraint names or stack traces.
8. **Never log or return connection strings, credentials, SQL errors or stack
   traces.** Server-only config is read via `getServerEnv()`; only `VITE_`-prefixed
   variables reach the browser bundle.

## Commands

```bash
npm install
npm run dev              # API + web together
npm run lint             # type-aware ESLint
npm run typecheck
npm test                 # Vitest: unit + integration (no database needed)
npm run test:e2e         # Playwright (starts both servers itself)
npm run build
npm run db:generate && npm run db:migrate && npm run db:seed
npm run format           # Prettier; run before committing
```

PostgreSQL (`docker compose up -d postgres`) is required for `db:*` commands and
for `npm run test:e2e`. `npm test` needs no database — integration tests use
`app.inject()` with stub probes.

## Realtime (Phases 8.1–8.5)

Realtime is a **notification** channel, never a second business-logic path. REST
changes state, PostgreSQL stores it, the outbox records what changed, SSE tells
clients to refetch. Realtime never mutates state; payloads are small flat maps,
never a read model.

- A business change and its outbox event are written in the **same**
  `UnitOfWork.runInTransaction` block via `RealtimeEventService.record(client, …)`.
  A rollback must write neither. Services never publish to SSE directly.
- Event names live in `packages/application/src/realtime/event-types.ts`
  (`REALTIME_EVENTS` / `REALTIME_AGGREGATES`). Never scatter string literals.
- The `realtime_events` outbox is the source of truth for delivery;
  PostgreSQL `LISTEN`/`NOTIFY` is a wake-up only (at-least-once, stamped only
  after delivery). Do not turn NOTIFY into a lossy path or drop the poll.
- Do not emit events for reads, plain create/edit mutations or no-op operations.
- The SSE route reuses `RealtimeEventPublisher`, never queries Prisma and never
  mutates state. `Last-Event-ID` is informational — no replay.
- Web: one `EventSource` per hook instance; the client mirrors connection state
  and never adds a reconnect loop. Named frames are delivered via
  `addEventListener`, not `onmessage`.
- Live UI sync: screens call `useTournamentRefresh(query.refetch)` with their
  existing REST query. Never a second store, never a second data-fetching
  framework (the project uses `useApiQuery`, not TanStack Query).

## Gotchas

- **Known e2e flake.** `e2e/phase8-6-hardening.spec.ts` ("a reconnect after missed
  events recovers the authoritative state") fails intermittently on `main` and on
  unrelated branches, independently of your change. Phase 8.6 is not implemented.
  If it is the only failing spec, re-run the failed job
  (`gh run rerun <run-id> --failed`) rather than changing product code or the
  spec. See `docs/ai-development-loop.md`.
- `localhost` and `127.0.0.1` are distinct browser origins; both are in the
  default `CORS_ORIGINS`. Change one, change the other or E2E reports `Unreachable`.
- Phase 2 constraints Prisma cannot express live in the `add_tournament_domain`
  migration. Do not re-add conflicting `@unique` attributes.
- Phase 7 scheduling conflicts are enforced by a PostgreSQL GiST `EXCLUDE`
  constraint (`matches_court_schedule_no_overlap`) plus `CHECK`s, hand-written in
  `add_courts_scheduling`. The `23P01` violation maps to a domain `ConflictError`.
  Pre-checks are not the concurrency boundary — do not remove the constraint.
- Scheduling is a `[start, end)` half-open interval; adjacent matches do not
  conflict. All three schedule fields are set together or all `NULL`.
- Prisma 7 resolves `env('DATABASE_URL')` eagerly, so `prisma.config.ts` loads
  `dotenv` itself. Migrations prefer `DIRECT_URL` over `DATABASE_URL`.
- Prisma generates into `packages/database/generated/prisma` (gitignored). Run
  `npm run db:generate` after a fresh clone.
- The seed is idempotent (upserts on fixed UUIDs); running it twice must not
  duplicate rows. Never replace upserts with `create`.
- Database integration tests use a dedicated `<database>_test` database; the
  `schema=` URL parameter is ignored by `@prisma/adapter-pg`.
- Historical migrations are forward-only — never modify them.

## AI development loop

The repository owns a closed, automatic loop: ChatGPT architect → OpenHands
implementation → GitHub PR → GitHub Actions CI → ChatGPT review → OpenHands fixes
the same PR → CI → ChatGPT re-review (up to `maxReviewRounds = 3`) → merge gate
(automatic) → next-task generation. A human is an exception handler only: the
loop stops for one on a genuine hard stop, never on the normal path.

- ChatGPT is the architect **and the reviewer**; OpenHands is the implementer and
  the fixer. OpenHands never reviews its own work: the review stage is
  `.ai/scripts/chatgpt-review.mjs` (`AI loop review` workflow), which waits for CI,
  records a round, posts the findings and dispatches a fix on the same PR.
- A push from an OpenHands fix fires `synchronize`, so the next review round runs
  with no manual step. A head SHA that a previous review already covered is never
  reviewed twice.

- Configuration, prompts, schemas and state live in `.ai/`; the full guide is
  `docs/ai-development-loop.md`.
- The loop is **infrastructure only**: never implement product features outside a
  task brief, never redesign the web application and never touch production data.
  The **merge gate** merges automatically, but only when the review is
  `approved`, required CI is green, the approval matches the head commit and no
  protected path changed. Never merge by hand and never bypass branch protection.
- One task at a time (`maxConcurrentTasks` is `1`): never start a task while
  another is implementing, fixing, reviewing or awaiting merge.
- Record progress with `node .ai/scripts/loop-state.mjs` (never edit the state
  JSON by hand) and validate with
  `node .ai/scripts/validate-loop-config.mjs`.
- `protectedPaths` from `.ai/loop.config.json` (migrations, seed, `ci.yml`,
  `.env`) require human review — flag them, do not edit them silently.
- A fix round updates the **same** PR and the same branch; never open a second PR.

## Before opening a pull request

Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`
(plus `npm run test:e2e` when browser behaviour changed), run `npm run format`,
and re-read the full `git diff` for leaked secrets, debug leftovers and scope
creep. Report exact results — if a command was not run, say so.

See `references/architecture.md` for the package responsibilities and the
endpoint/DTO conventions, and `.ai/prompts/` for the AI development-loop stages.
