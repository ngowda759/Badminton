# AGENTS.md

Repository guidance for automated agents working on Badminton V2.

## What this repository is

Badminton V2 — a badminton tournament management platform. **Phases 1 (foundation),
2 (tournament database/domain/application/infrastructure), 3 (REST API layer),
4 (tournament setup UI) and 5 (group-stage scheduling and scoring) are implemented.**
The Prisma schema, migrations, constraints, indexes, seed, database tests, domain
types/rules, application services, repository ports, Prisma repository adapters,
application/domain error model, the Fastify `/api/v1` REST surface, the tournament
setup UI and group-stage match scoring/standings exist. **Draw generation, knockout
advancement, rankings, scheduling/court/venue management, authentication and
result-correction workflows are not implemented.** Do not add those unless the task
explicitly asks for a later phase. The authoritative design is
`docs/phase-2-domain-design.md`; the Phase 2.2 architecture is
`docs/phase-2-2-architecture.md`; the REST API reference is
`docs/phase-3-rest-api.md`; Phase 5 scoring is `docs/phase-5-group-scoring.md`.

## Layout

- `apps/api` — Fastify API. `app.ts` is the factory, `server.ts` owns `listen`.
  `src/http/` holds the `/api/v1` routes, request/response helpers and the
  `ApiServices` interface; `src/errors/` holds the API error model and HTTP error
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
