# AGENTS.md

Repository guidance for automated agents working on Badminton V2.

## What this repository is

Badminton V2 — a badminton tournament management platform. **Phases 1 (foundation),
2 (tournament database/domain/application/infrastructure), 3 (REST API layer),
4 (tournament setup UI), 5 (group-stage scheduling and scoring), 6 (knockout
stage, bracket management and progression), 7 (court management, match
scheduling and tournament dashboard), 8.1 (the realtime transactional outbox),
8.2 (the realtime SSE transport), 8.3 (application event publishing), 8.4
(the browser realtime `EventSource` client) and 8.5 (live UI synchronization)
are implemented; Phase 8.6 (multi-device hardening) is not implemented.**
The Prisma schema, migrations, constraints, indexes, seed, database tests, domain
types/rules, application services, repository ports, Prisma repository adapters,
application/domain error model, the Fastify `/api/v1` REST surface, the tournament
setup UI, group-stage match scoring/standings, the knockout bracket workflow,
the Phase 7 operational layer (courts, scheduling, court board and dashboard), the
Phase 8.1 realtime outbox (event catalogue, repository port, Prisma adapter,
publisher, dispatcher and PostgreSQL `LISTEN`/`NOTIFY` wake-up), the Phase 8.2
SSE endpoint (`GET /api/v1/tournaments/:tournamentId/events`, SSE frame codec,
connection adapter and heartbeat), the Phase 8.3 application-service event
publishing (each live-tournament mutation records its outbox row in the same
`UnitOfWork` transaction), the Phase 8.4 browser realtime client (tournament-
scoped `EventSource` lifecycle, connection state and event parsing, exposed via
`useTournamentRealtime`) and the Phase 8.5 live UI synchronization (the
tournament-scoped refresh bus that turns a realtime event or reconnect into an
authoritative REST refetch) exist.
**Automatic draw/seeding, rankings, authentication, authorization,
result-correction workflows and Phase 8.6 multi-device hardening are not
implemented.**
Do not add those unless the task explicitly asks for a later phase. The
authoritative design is `docs/phase-2-domain-design.md`; the Phase 2.2
architecture is `docs/phase-2-2-architecture.md`; the REST API reference is
`docs/phase-3-rest-api.md`; Phase 5 scoring is `docs/phase-5-group-scoring.md`;
Phase 6 knockout is `docs/phase-6-knockout.md`; Phase 7 courts/scheduling/dashboard
is `docs/phase-7-courts-dashboard.md`; Phase 8 realtime is
`docs/phase-8-realtime.md`.

## Layout

- `.ai/` — the AI development loop: `loop.config.json` (knobs and guardrails),
  `prompts/` (architect, implementation, review, fix, next-task), `schemas/`
  (JSON Schemas for config/state/briefs/reviews), `state/` (durable state, task
  queue, append-only review log) and `scripts/` (dependency-free validation and
  state helpers). See `docs/ai-development-loop.md`.
- `.openhands/skills/badminton-development/` — the repository skill loaded by
  automated agents.
- `apps/api` — Fastify API. `app.ts` is the factory, `server.ts` owns `listen`.
  `src/http/` holds the `/api/v1` routes, request/response helpers and the
  `ApiServices` interface; `src/http/sse/` holds the SSE frame codec and connection
  adapter (Phase 8.2); `src/errors/` holds the API error model and HTTP error
  mapper; `src/composition/` wires Prisma repositories into application services.
- `apps/web` — React 19 + Vite + Tailwind v4 + shadcn/ui.
- `packages/domain` — pure types, lifecycle tables, normalization, dates, errors. No runtime deps.
- `packages/validation` — shared Zod schemas, `parseRequest` and tournament input schemas.
- `packages/application` — services, repository ports and the `UnitOfWork` transaction port.
- `packages/infrastructure` — Prisma repository adapters and Prisma-error translation.
- `packages/database` — Prisma client lifecycle, `DatabaseProbe` port, health check.
- `packages/config` — `.env` loading, Zod-validated server and client config.
- `prisma/` — schema, migrations, idempotent seed. Root `prisma.config.ts` owns the CLI config.

## Conventions

- Shared packages export TypeScript source (`"exports": "./src/index.ts"`); imports use
  explicit `.ts` extensions (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`).
- TypeScript is strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
  `verbatimModuleSyntax`. No `any`, no `@ts-ignore`. Unused variables must be prefixed `_`.
- Business logic never lives in route handlers or React components. Routes delegate to
  services; components delegate to hooks/clients in `lib/`.
- Route handlers must not import Prisma. Go through `packages/database` ports.
- Application services depend only on repository ports; they never import Prisma, Fastify or
  HTTP types. Prisma lives in `packages/infrastructure` (and `packages/database`). Keep
  business rules in services/domain, not in repositories.
- Services take a plain `RepositoryClient` for reads and single writes and receive
  `UnitOfWork` only when they own a multi-row atomic operation. Do not open an interactive
  transaction for a read or a single write; add a transaction only where atomicity requires
  it, and cover the boundary with `tests/unit/application/transaction-boundaries.test.ts`.
- Repositories translate known Prisma constraint failures into `@badminton/domain` errors
  (never leak SQL, constraint names or stack traces). The database stays the final
  consistency boundary; pre-checks alone are not enough.
- Never log or return connection strings, credentials, SQL errors or stack traces.
- Server-only config is read via `getServerEnv()`. Only `VITE_`-prefixed variables reach
  the browser bundle.

## Commands

```bash
npm install
npm run dev              # API + web together
npm run lint             # type-aware ESLint
npm run typecheck
npm test                 # Vitest: unit + integration
npm run test:e2e         # Playwright (starts both servers itself)
npm run build
npm run db:generate && npm run db:migrate && npm run db:seed
npm run format           # Prettier; CI runs format:check via lint only — run format before committing
node .ai/scripts/validate-loop-config.mjs   # AI loop config + state + schemas
node .ai/scripts/validate-workflows.mjs     # workflow structure and permissions
```

## Local prerequisites

PostgreSQL via `docker compose up -d postgres` is required for `db:*` commands and for
`npm run test:e2e` (the UI asserts the database reports `Connected`). `npm test` needs no
database — integration tests use `app.inject()` with stub probes.

## Gotchas

- `localhost` and `127.0.0.1` are distinct browser origins. Both are in the default
  `CORS_ORIGINS`; if you change one, change the other or E2E will report `Unreachable`.
- Phase 2 constraints Prisma cannot express (row-local `CHECK`s and partial unique
  indexes) live in the `add_tournament_domain` migration. Do not re-add conflicting
  Prisma `@unique` attributes for those columns. Phase 2 timestamps are `timestamptz`
  (`@db.Timestamptz(3)`) and ordinal columns (`sequence`, `slot`, `position`, `drawSize`,
  `roundNumber`) are `smallint` (`@db.SmallInt`); `seed` and `matchNumber` stay `integer`.
- The database integration tests (`tests/integration/database/`) run against real
  PostgreSQL in a dedicated `<database>_test` database, created and migrated on first
  use. They skip when no database is reachable, but fail the run when `CI` is set or
  `REQUIRE_DATABASE_TESTS=1` is set. The `schema=` URL parameter is ignored by
  `@prisma/adapter-pg` (`current_schema()` stays `public`), so isolation uses a separate
  database, not a schema.
- Never log or return connection strings, credentials, SQL errors or stack traces.
- Server-only config is read via `getServerEnv()`. Only `VITE_`-prefixed variables reach
  the browser bundle.
- Prisma 7 resolves `env('DATABASE_URL')` eagerly when `prisma.config.ts` is imported, so
  that file loads `dotenv` itself before calling `defineConfig`. Migrations prefer
  `DIRECT_URL` over `DATABASE_URL`; local Docker sets only `DATABASE_URL`, Supabase sets
  both (pooled runtime URL plus a direct DDL URL). Never commit either.
- Prisma generates into `packages/database/generated/prisma`, which is gitignored. Run
  `npm run db:generate` after a fresh clone.
- The seed is idempotent: Phase 2 fixtures upsert on fixed UUIDs and metadata on its key.
  Running it twice must not duplicate rows; never replace the upserts with `create`.
- Phase 7 scheduling conflicts are enforced by a PostgreSQL GiST `EXCLUDE` constraint
  (`matches_court_schedule_no_overlap`) over `courtId` + `tstzrange(start, end, '[)')`, plus
  `matches_schedule_fields_consistent` / `matches_schedule_range_valid` `CHECK`s. They are
  hand-written in the `add_courts_scheduling` migration (Prisma cannot express them; the
  `btree_gist` extension is required). The infrastructure layer translates the `23P01`
  exclusion violation into a domain `ConflictError`. Application pre-checks give friendly
  messages but are not the concurrency boundary — do not remove the constraint or replace
  the migration.
- Scheduling is a `[start, end)` half-open interval: adjacent matches (10:00–10:30 and
  10:30–11:00) do not conflict. All three schedule fields (`courtId`, `scheduledStartAt`,
  `scheduledEndAt`) are set together or all `NULL`; a partially scheduled match is rejected
  by the database.
- The dashboard (`TournamentDashboardService`) is a read-only derived model. It must not
  persist anything and must not fan out into per-match queries — competitor names come from
  two batched `listByIds` reads, and matches/courts/categories/stages/entries are each
  loaded once per tournament.
- Phase 8 realtime is a **notification** channel, never a second business-logic path: REST
  changes state, PostgreSQL stores it, the outbox records what changed, SSE (Phase 8.2)
  tells clients to refetch. Realtime never mutates state and payloads are small flat maps,
  never a read model.
- Business change + outbox event are written in the **same** `UnitOfWork.runInTransaction`
  block via `RealtimeEventService.record(client, …)`; a rollback must write neither, and a
  multi-event operation (e.g. `MATCH_COMPLETED` + `KNOCKOUT_MATCH_POPULATED`) commits them
  together. Services never publish to SSE directly — only the dispatcher forwards committed
  rows through the publisher.
- The `realtime_events` outbox is the source of truth for delivery. PostgreSQL
  `LISTEN`/`NOTIFY` (trigger `realtime_events_notify` → `pg_notify('realtime_events', …)`)
  is a wake-up only: a lost notification costs latency, never correctness, because the
  dispatcher also polls and stamps `publishedAt` only after delivery (at-least-once). Do
  not turn NOTIFY into a lossy delivery path or drop the poll.
- The notifier uses a dedicated `pg` connection outside the Prisma pool so a long-lived
  `LISTEN` never occupies a pooled client. The `realtime_events` migration is forward-only;
  do not modify historical migrations.
- `REALTIME_POLL_INTERVAL_MS` and `REALTIME_HEARTBEAT_INTERVAL_MS` are server-only config
  read through `getServerEnv()`; keep the intervals configurable rather than hard-coded.
- Phase 8.2 SSE lives in `apps/api/src/http/sse/` (`sse-frame.ts` codec,
  `sse-connection.ts` adapter) with the route in `src/http/routes/realtime.routes.ts`.
  It must reuse `RealtimeEventPublisher` (never a second subscriber registry), never
  query Prisma/the outbox or call a business service, and never mutate state. A sink that
  fails to write is removed silently; cleanup is idempotent and must clear the heartbeat
  timer and unsubscribe. The route's `preClose` hook ends live streams so `app.close()`
  resolves. `Last-Event-ID` is accepted but informational only — no replay. Disconnect
  detection must be registered on the request/response before subscribing, and the closed
  state re-checked after each setup step, so a client that leaves mid-setup cannot leak a
  subscription or a timer. A full socket buffers frames up to a byte cap and flushes on
  `drain`; a client past the cap is dropped, so a slow client never blocks the publisher or
  grows memory without bound. SSE tests must bind a real socket (a hijacked stream cannot
  be driven through `app.inject`) and use a short injected `realtimeHeartbeatIntervalMs`/
  timer seam, never real-time waits.
- Phase 8.3 publishing lives in the application services: each integrated mutation
  (`MatchSchedulingService`, `MatchService.transitionStatus`, `MatchResultService`,
  `CourtService`, and the tournament/category/stage/entry `transitionStatus`) opens one
  `UnitOfWork.runInTransaction` and calls `RealtimeEventService.record(tx, …)` on the
  transaction client, so the business row and its outbox row commit or roll back together.
  Event names are centralised in `packages/application/src/realtime/event-types.ts`
  (`REALTIME_EVENTS` / `REALTIME_AGGREGATES`, typed against the domain catalogue) — never
  scatter string literals. Do not catch an event-write error and continue, do not add a
  second publishing path, and do not emit events for reads, plain create/edit mutations or
  no-op/idempotent operations (a replayed knockout progression returns `false`, so the
  caller records nothing). Payloads stay empty/flat — the client refetches REST.
- Phase 8.4 web realtime lives in `apps/web/src/realtime/` (`realtime-types.ts` union +
  parser, `realtime-client.ts` framework-free `EventSource` lifecycle,
  `use-tournament-realtime.ts` React binding). It is a signal source only: it must never
  fetch dashboard data, call a REST endpoint, invalidate a query or mutate state — that is
  Phase 8.5. One `EventSource` per hook instance, closed on unmount and on tournament
  change; `start()` is idempotent so React Strict Mode cannot open two sockets. The event
  envelope is validated in `@badminton/validation` (`realtimeEventEnvelopeSchema`) — reuse
  it rather than re-parsing JSON ad hoc, drop malformed frames without closing the stream,
  and never add a custom reconnect loop (the native `EventSource` retries; the client only
  mirrors its state). No `Last-Event-ID`, no replay. The server names every frame with an
  `event:` field, so the client must subscribe per catalogue type with
  `addEventListener(REALTIME_EVENT_TYPES…)` — a named frame is never delivered to
  `onmessage` (`onmessage` is kept only as a fallback for an unnamed frame).
- Phase 8.5 live UI sync lives in `apps/web/src/realtime/tournament-refresh.tsx`
  (`TournamentRealtimeProvider`, `useTournamentRefresh`, `RealtimeStatusIndicator`).
  `TournamentLayout` mounts one provider per open tournament; it is the only
  `useTournamentRealtime` consumer, so exactly one `EventSource` opens per tournament
  regardless of how many screens register. Each screen calls
  `useTournamentRefresh(query.refetch)` with its own existing REST query — never a second
  store, never a second data-fetching framework (the project uses `useApiQuery`, not
  TanStack Query). Any valid event or a reconnect invalidates the registered REST queries;
  the event payload is never read as a read model and there is no `switch (event.event)`
  and no per-event business logic. Event bursts are coalesced by a small
  `DEFAULT_REFRESH_COALESCE_MS` (60 ms) window whose pending flush is cancelled on unmount;
  the first `CONNECTED` does not refetch (the initial REST load already ran), a later
  `CONNECTED` after `RECONNECTING`/`DISCONNECTED` does. Invalidation is tournament-scoped —
  never a global `invalidateQueries()`. Realtime failure is isolated: REST, manual refresh
  and the initial load all work with the stream down, and a realtime-triggered refetch
  failure uses the screen's existing error state (no new global error system).
  `corsOrigins` (the app's `CORS_ORIGINS` allowlist) is applied to the hijacked SSE
  response in `apps/api/src/http/routes/realtime.routes.ts` as well as to ordinary routes,
  because `reply.hijack()` bypasses `@fastify/cors`.
