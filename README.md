# Badminton V2

A badminton tournament management platform, rebuilt from scratch as a typed full-stack
monorepo.

**Phases 1–7 are implemented:** the foundation (Phase 1), the tournament
database/domain/application layers (Phase 2), the REST API layer (Phase 3), the
tournament setup UI (Phase 4), group-stage scheduling and scoring (Phase 5), the
knockout stage and bracket management (Phase 6), and court management, match
scheduling and the tournament dashboard (Phase 7). The API exposes the application
services under `/api/v1` ([docs/phase-3-rest-api.md](docs/phase-3-rest-api.md)); the
web application drives them through a typed API client
([docs/phase-4-tournament-ui.md](docs/phase-4-tournament-ui.md)); the Phase 7
operational layer is documented in
[docs/phase-7-courts-dashboard.md](docs/phase-7-courts-dashboard.md).
Draw generation, automatic scheduling, ranking and realtime are intentionally absent;
see [Future phases](#future-phases).

---

## Architecture

Each layer depends only on the layer below it. A route handler never touches Prisma,
and a React component never talks to the database.

```
React / Vite  (apps/web)
      |
      v
Fastify API   (apps/api/src/http — routes, validation, error mapping)
      |
      v
Application services  (packages/application)
      |
      v
Domain rules  (packages/domain)
      |
      v
Repository ports  (packages/application)
      |
      v
Prisma infrastructure  (packages/infrastructure)
      |
      v
PostgreSQL
```

Application services depend only on repository ports; Prisma lives in
`packages/infrastructure`. Routes parse, validate with Zod, delegate to a service and
map the result — business rules stay in the domain/application layer.

`GET /health` predates the domain services and is unchanged:

```
health.route.ts            parses nothing, serialises the result, picks the HTTP status
      |
      v
health.service.ts          turns dependency probes into the health contract
      |
      v
database/health-check.ts   adapts a probe into a domain HealthCheck, enforces a timeout
      |
      v
database/probe.ts          DatabaseProbe port (SELECT 1)
      |
      v
Prisma + @prisma/adapter-pg
      |
      v
PostgreSQL
```

The payoff is testability: `buildApp()` accepts its probes and `ApiServices` as
arguments, so tests exercise the real Fastify pipeline through `app.inject()` — with
fakes and no socket, or against real PostgreSQL for the vertical-slice suite.

## Repository structure

```
Badminton/
├── apps/
│   ├── api/                     Fastify API
│   │   ├── src/
│   │   │   ├── app.ts           buildApp() factory — wired, not listening
│   │   │   ├── server.ts        process entry point: config, listen, shutdown
│   │   │   ├── composition/     service composition root (Prisma → services)
│   │   │   ├── config/          validated runtime configuration
│   │   │   ├── http/            REST surface: routes, request/response helpers
│   │   │   ├── errors/          API error model and HTTP error mapping
│   │   │   ├── routes/          the Phase 1 health route
│   │   │   ├── services/        the Phase 1 health service
│   │   │   ├── plugins/         CORS, error handling
│   │   │   └── infrastructure/  adapters (logger, database checks)
│   │   └── package.json
│   └── web/                     React + Vite client
│       ├── src/
│       │   ├── app.tsx          root: providers, error boundary, router
│       │   ├── routes.tsx       route tree
│       │   ├── api/             typed API client, services, DTOs, provider
│       │   ├── pages/           route screens (tournaments, players, teams)
│       │   ├── components/      shared components + shadcn/ui primitives
│       │   ├── hooks/           query/mutation/recent hooks
│       │   ├── lib/             pure logic (errors, lifecycle, validation, format)
│       │   └── config/          validated client configuration
│       ├── tests/               stub API + flow tests
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
├── packages/
│   ├── domain/                  framework-free types and contracts
│   ├── validation/              shared Zod schemas and request validation
│   ├── application/             services, repository ports, unit of work
│   ├── infrastructure/          Prisma repository adapters
│   ├── database/                Prisma client, connection and probe abstraction
│   └── config/                  environment loading and Zod validation
├── docs/
│   ├── phase-2-domain-design.md  authoritative domain design
│   ├── phase-2-2-architecture.md Phase 2.2 service/port architecture
│   └── phase-3-rest-api.md       REST API reference
├── prisma/
│   ├── schema.prisma            infrastructure model only
│   ├── migrations/              committed SQL migrations
│   └── seed.ts                  deterministic, idempotent seed
├── tests/
│   ├── unit/                    pure logic, stubbed dependencies
│   └── integration/             app.inject(); API + real-PostgreSQL suites
├── e2e/                         Playwright specs
├── .github/workflows/ci.yml     continuous integration
├── docker-compose.yml           local PostgreSQL
├── prisma.config.ts             Prisma CLI configuration (Prisma 7)
├── vitest.config.ts
├── playwright.config.ts
├── tsconfig.base.json           shared strict compiler options
└── package.json                 npm workspaces + root scripts
```

### Package responsibilities

| Package                 | Owns                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `@badminton/domain`     | Types and contracts only. No runtime dependencies.                   |
| `@badminton/validation` | Shared Zod schemas, the reusable `parseRequest` helper.              |
| `@badminton/database`   | Prisma client lifecycle, the `DatabaseProbe` port, the health check. |
| `@badminton/config`     | `.env` loading, Zod-validated server and client configuration.       |

Shared packages are consumed as TypeScript source (`"exports": "./src/index.ts"`), so
there is no build step between editing a package and the API picking it up. `tsc`
compiles the API to `apps/api/dist` for production, and Vite bundles the web app.

## Prerequisites

- **Node.js** >= 22 (developed on 24.x)
- **npm** 10+
- **Docker** with the Compose plugin

## Installation

```bash
npm install
```

### Windows quick start

After installing Node.js 22 or later and installing dependencies once, start the
local app with:

```powershell
npm run start:local
```

This command starts the local PostgreSQL database (or the Docker Compose database
when no local PostgreSQL data directory exists), generates the Prisma client,
applies pending migrations, and runs the idempotent seed before starting the API
and web app. It refuses to migrate a non-local database. Keep the terminal open
while developing; press `Ctrl+C` to stop the app. The database files and seed data
remain available for the next run.

## Environment setup

```bash
cp .env.example .env
```

`.env` is gitignored. Every variable is validated with Zod at startup — the API refuses
to boot on invalid configuration and reports variable _names_, never values.

| Variable            | Scope  | Default                 | Purpose                                                             |
| ------------------- | ------ | ----------------------- | ------------------------------------------------------------------- |
| `NODE_ENV`          | server | `development`           | `development` \| `test` \| `production`                             |
| `API_PORT`          | server | `3000`                  | Port the Fastify API listens on                                     |
| `DATABASE_URL`      | server | — (required)            | PostgreSQL connection string; must use a `postgres://` scheme       |
| `CORS_ORIGINS`      | server | `''`                    | Comma-separated browser origins. Empty disables CORS (fails closed) |
| `LOG_LEVEL`         | server | `info`                  | `debug` \| `info` \| `warn` \| `error`                              |
| `TRUST_PROXY`       | server | `false`                 | Trust `X-Forwarded-*` headers; `true` \| `false` only               |
| `WEB_PORT`          | web    | `5173`                  | Vite dev server port                                                |
| `VITE_API_BASE_URL` | client | `http://localhost:3000` | Base URL the browser uses to reach the API                          |
| `POSTGRES_*`        | docker | `badminton`             | Credentials used by `docker-compose.yml`                            |

`VITE_`-prefixed variables are inlined into public JavaScript. Nothing server-side may
use that prefix — server configuration is only read through `getServerEnv()`.

`TRUST_PROXY` defaults to `false`. Leave it off unless a reverse proxy that overwrites
`X-Forwarded-*` headers runs in front of the API: those headers are client-controlled
otherwise, so trusting them lets a caller forge its own address and protocol. Only the
exact values `true` and `false` are accepted; anything else (including `1`, `yes`, `TRUE`)
fails startup rather than silently choosing a state.

`.env` is resolved from the repository root as well as the current directory, so
`npm run dev` works whether it is launched from the root or from `apps/api`.

## Database

```bash
docker compose up -d postgres
docker compose ps
docker compose logs postgres

npm run db:generate   # generate the Prisma client
npm run db:migrate    # create/apply migrations (development)
npm run db:seed       # deterministic, idempotent
```

The container uses a named volume (`badminton-postgres-data`) so data survives
`docker compose down`; `docker compose down -v` removes it. The healthcheck makes
`docker compose ps` report readiness, so you can wait for `(healthy)` before migrating.

The seed is idempotent: every row is an `upsert` on a unique key, so repeated runs
converge on the same three `system_metadata` rows instead of duplicating them. It
inserts infrastructure metadata only — never tournament data.

## Development

```bash
npm run dev
```

Runs the API (`tsx watch`) and the Vite dev server together. Open
<http://localhost:5173>; the shell displays live API and database status fetched from
`GET /health`.

Useful individual commands:

```bash
npm run dev:api
npm run dev:web
curl http://localhost:3000/health
```

## REST API

The API exposes the tournament domain under `/api/v1`. `GET /health` is unchanged.
PostgreSQL must be running and migrated; start it with `docker compose up -d postgres`
then `npm run db:migrate`.

- **Base URL:** `http://localhost:3000`
- **Health:** `GET /health` → `{ "status": "ok", "database": "connected" }`
- **Version:** `/api/v1`

Endpoint groups:

| Group              | Example                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Tournaments        | `POST /api/v1/tournaments`, `GET/PATCH /api/v1/tournaments/:id`, `POST /api/v1/tournaments/:id/transition`                            |
| Categories         | `POST /api/v1/tournaments/:tournamentId/categories`, `GET/PATCH /api/v1/categories/:id`, `POST /api/v1/categories/:id/transition`     |
| Players            | `POST /api/v1/players`, `GET/PATCH /api/v1/players/:id`                                                                               |
| Teams and members  | `POST /api/v1/teams`, `GET /api/v1/teams/:id/members`, `POST /api/v1/teams/:id/members`, `DELETE /api/v1/teams/:id/members/:playerId` |
| Entries            | `POST /api/v1/categories/:categoryId/entries`, `GET /api/v1/entries/:id`, `POST /api/v1/entries/:id/{confirm,withdraw,disqualify}`    |
| Stages and matches | `POST /api/v1/categories/:categoryId/stages`, `POST /api/v1/stages/:stageId/matches`, `POST /api/v1/matches/:id/transition`           |
| Participants       | `GET/POST /api/v1/matches/:matchId/participants`                                                                                      |

Conventions:

- Success is `{ "data": <resource> }` or `{ "data": [...] }`; create returns `201`,
  read/update/transition `200`, member removal `204`.
- Errors share one envelope: `{ "error": { "code", "message", "details"? } }`.
  Validation is `400`, missing resources `404`, conflicts and illegal lifecycle
  transitions `409`, cross-record rule violations `422`, unexpected failures `500`.
- Every body and path parameter is validated with the shared Zod schemas before any
  service runs. Business rules stay in the application/domain layer.

The full endpoint table, error mapping and validation notes are in
[docs/phase-3-rest-api.md](docs/phase-3-rest-api.md).

## Tests

```bash
npm test                          # Vitest: backend unit + integration, then web
npm run test --workspace @badminton/web   # web only
npm run test:e2e                  # Playwright
```

`npm test` covers environment validation, the database health abstraction, the health
service, the shared Zod schemas and the health endpoint itself. Integration tests build
a real Fastify instance with `buildApp()` and drive it with `app.inject()`, so no server
or database process is needed. The web suite runs afterwards in jsdom with Testing
Library, mocking only the API boundary, so it needs no database either.

`npm run test:e2e` starts the API and the web dev server automatically via Playwright's
`webServer` configuration — nothing needs to be started by hand. PostgreSQL must be
running and migrated, because the UI asserts that the database reports `Connected`:

```bash
docker compose up -d postgres
npm run db:migrate
npm run test:e2e
```

If a dev server is already running locally, Playwright reuses it
(`reuseExistingServer`); in CI it always starts fresh.

## Build

```bash
npm run build
```

Compiles the API to `apps/api/dist` with `tsc` and produces the web bundle in
`apps/web/dist` via Vite.

## Other commands

```bash
npm run lint          # ESLint (type-aware)
npm run lint:fix
npm run typecheck     # tsc --noEmit across the workspace
npm run format        # Prettier
npm run format:check
npm run db:studio     # Prisma Studio
npm run db:reset      # drop, re-migrate and re-seed
```

## CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`:

1. `npm ci` — lockfile-exact install
2. `npm run db:generate`
3. `npm run lint`
4. `npm run typecheck`
5. `npm test` — unit + integration
6. `npm run build`
7. `npm run test:e2e` — Playwright, with the browser cached

PostgreSQL runs as a GitHub Actions service container with a healthcheck, and migrations
are applied with `prisma migrate deploy` before the tests. No secrets live in the
workflow: the CI database URL is an inline throwaway credential for a container that
only exists for the duration of the job.

## Phase scope

Phase 1 — foundation:

- npm workspaces monorepo with a shared strict TypeScript configuration
- React 19 + Vite + Tailwind CSS v4 + shadcn/ui foundation
- Fastify API with an application factory, explicit CORS, structured errors
- `GET /health` reporting API liveness and PostgreSQL connectivity
- Prisma 7 + PostgreSQL with an intentionally minimal `SystemMetadata` model
- Docker Compose PostgreSQL with a named volume and healthcheck
- Zod-validated environment configuration for server and client
- Vitest unit and integration suites, Playwright E2E
- ESLint, Prettier, EditorConfig, GitHub Actions

Phase 2 — tournament domain and data:

- Tournaments, categories, players, teams, entries, stages, matches and match
  participants in the Prisma schema, with migrations, constraints and indexes
- Framework-free domain rules (lifecycles, normalization, invariants) in
  `@badminton/domain`
- Application services and repository ports in `@badminton/application`
- Prisma repository adapters and Prisma-error translation in `@badminton/infrastructure`

Phase 3 — REST API:

- Fastify composition (`buildApp`) exposing the application services under `/api/v1`
- Zod validation for every body and path parameter at the boundary
- One centralized HTTP error mapper and a single error/response envelope
- Route handlers with no Prisma, no transactions and no business logic
- API route tests over fakes and HTTP-to-PostgreSQL vertical-slice tests
- `/health` preserved unchanged

Phase 4 — tournament setup UI:

- React Router route tree and a reusable application shell (responsive navigation)
- A centralized, typed API client over `/api/v1` with a structured `ApiError`
- Tournament, category, player, team, entry, stage and match screens
- Lifecycle actions derived from the shared domain transition tables
- Registration for singles (player) and doubles (team) entries
- Loading, empty and error states, confirmation dialogs and accessible forms
- Vitest component/page tests against a stub API, plus a Playwright setup flow
- See [docs/phase-4-tournament-ui.md](docs/phase-4-tournament-ui.md)

Phase 5 — group-stage scheduling and scoring:

- Group-stage match scoring using the authoritative badminton scoring rules
- Derived, stage-isolated standings over active entries
- Match lifecycle actions (SCHEDULED → IN_PROGRESS → COMPLETED) unchanged
- See [docs/phase-5-group-scoring.md](docs/phase-5-group-scoring.md)

Phase 6 — knockout stage and bracket management:

- Single-elimination bracket generation for supported draw sizes
- Atomic winner progression through the bracket into the final
- Bracket retrieval API and knockout UI
- See [docs/phase-6-knockout.md](docs/phase-6-knockout.md)

Phase 7 — court management, match scheduling and tournament dashboard:

- Per-tournament courts with unique numbers and an ACTIVE/INACTIVE lifecycle
- Operator-controlled match scheduling on an active court with a `[start, end)` window
- Overlapping schedules rejected by a database GiST exclusion constraint
- A court board and an aggregated tournament dashboard read model
- See [docs/phase-7-courts-dashboard.md](docs/phase-7-courts-dashboard.md)

Intentionally **not** implemented: authentication and authorization, draw generation,
automatic scheduling, ranking, realtime subscriptions, payments and notifications. No
API OpenAPI/Swagger surface; the REST API is documented in Markdown.

## Future phases

| Phase | Scope                                 |
| ----- | ------------------------------------- |
| 1     | Foundation ✅                         |
| 2     | Tournament domain and database ✅     |
| 3     | REST API layer ✅                     |
| 4     | Tournament setup UI ✅                |
| 5     | Group-stage scheduling and scoring ✅ |
| 6     | Knockout engine ✅                    |
| 7     | Live courts and dashboard ✅          |
| 8     | Multi-device and realtime             |
| 9     | Deployment (Supabase + free tier)     |
