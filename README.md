# Badminton V2

A badminton tournament management platform, rebuilt from scratch as a typed full-stack
monorepo.

**This repository currently contains Phase 1 only — the foundation.** The monorepo,
API, database layer, configuration, testing setup and CI are complete and verified.
Tournament features are intentionally absent; see [Phase 1 scope](#phase-1-scope) and
[Future phases](#future-phases).

---

## Architecture

Each layer depends only on the layer below it. A route handler never touches Prisma,
and a React component never talks to the database.

```
React / Vite  (apps/web)
      |
      v
Fastify API   (apps/api)
      |
      v
Domain / Services  (packages/domain, apps/api/src/services)
      |
      v
Prisma        (packages/database)
      |
      v
PostgreSQL
```

Concretely, `GET /health` flows like this:

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

The payoff is testability: `buildApp()` accepts its probes as arguments, so the
integration tests exercise the real Fastify pipeline through `app.inject()` with no
database and no bound socket.

## Repository structure

```
Badminton/
├── apps/
│   ├── api/                     Fastify API
│   │   ├── src/
│   │   │   ├── app.ts           buildApp() factory — wired, not listening
│   │   │   ├── server.ts        process entry point: config, listen, shutdown
│   │   │   ├── config/          validated runtime configuration
│   │   │   ├── routes/          HTTP surface, no business logic
│   │   │   ├── services/        business rules
│   │   │   ├── plugins/         CORS, error handling
│   │   │   └── infrastructure/  adapters (logger, database checks)
│   │   └── package.json
│   └── web/                     React + Vite client
│       ├── src/
│       │   ├── app.tsx          application shell
│       │   ├── components/      presentational components + shadcn/ui primitives
│       │   ├── hooks/           React state wiring
│       │   ├── lib/             API clients and pure presentation logic
│       │   └── config/          validated client configuration
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
├── packages/
│   ├── domain/                  framework-free types and contracts
│   ├── validation/              shared Zod schemas and request validation
│   ├── database/                Prisma client, connection and probe abstraction
│   └── config/                  environment loading and Zod validation
├── prisma/
│   ├── schema.prisma            infrastructure model only
│   ├── migrations/              committed SQL migrations
│   └── seed.ts                  deterministic, idempotent seed
├── tests/
│   ├── unit/                    pure logic, stubbed dependencies
│   └── integration/             real Fastify instance via app.inject()
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

## Tests

```bash
npm test          # Vitest: unit + integration
npm run test:e2e  # Playwright
```

`npm test` covers environment validation, the database health abstraction, the health
service, the shared Zod schemas and the health endpoint itself. Integration tests build
a real Fastify instance with `buildApp()` and drive it with `app.inject()`, so no server
or database process is needed.

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

## Phase 1 scope

Implemented:

- npm workspaces monorepo with a shared strict TypeScript configuration
- React 19 + Vite + Tailwind CSS v4 + shadcn/ui foundation
- Fastify API with an application factory, explicit CORS, structured errors
- `GET /health` reporting API liveness and PostgreSQL connectivity
- Prisma 7 + PostgreSQL with an intentionally minimal `SystemMetadata` model
- Docker Compose PostgreSQL with a named volume and healthcheck
- Zod-validated environment configuration for server and client
- Vitest unit and integration suites, Playwright E2E
- ESLint, Prettier, EditorConfig, GitHub Actions

Intentionally **not** implemented: tournament CRUD, player registration, teams, match
scheduling, groups, knockout brackets, scoring, ranking, court management, live scoring,
realtime subscriptions and tournament dashboards.

## Future phases

| Phase | Scope                              |
| ----- | ---------------------------------- |
| 1     | Foundation ✅                      |
| 2     | Tournament domain and database     |
| 3     | Tournament setup UI                |
| 4     | Group-stage scheduling and scoring |
| 5     | Knockout engine                    |
| 6     | Live courts and dashboard          |
| 7     | Multi-device and realtime          |
| 8     | Deployment (Supabase + free tier)  |
