# Badminton V2 — architecture reference

Supporting detail for the `badminton-development` skill. `AGENTS.md` and
`docs/phase-*.md` remain authoritative.

## Package responsibilities

| Package                     | Owns                                                                 |
| --------------------------- | -------------------------------------------------------------------- |
| `@badminton/domain`         | Types and contracts only. No runtime dependencies.                   |
| `@badminton/validation`     | Shared Zod schemas, the reusable `parseRequest` helper.              |
| `@badminton/database`       | Prisma client lifecycle, the `DatabaseProbe` port, the health check. |
| `@badminton/config`         | `.env` loading, Zod-validated server and client configuration.       |
| `@badminton/application`    | Services, repository ports, the `UnitOfWork` transaction port.       |
| `@badminton/infrastructure` | Prisma repository adapters, Prisma-error translation.                |

Shared packages are consumed as TypeScript source, so there is no build step
between editing a package and the API picking it up. `tsc` compiles the API to
`apps/api/dist`; Vite bundles the web app.

## API conventions

- All routes live under `/api/v1`; `GET /health` is unchanged and predates the
  domain services.
- Every body and path parameter is validated with Zod at the boundary; invalid
  input returns `400 VALIDATION_ERROR` through the single HTTP error mapper.
- Responses use one envelope; dedicated DTOs are returned — never raw Prisma or
  domain models.
- Collection endpoints are cursor-paginated over the unique `id`
  (`limit` 1–100 default 20, opaque `cursor`), ordered deterministically
  (newest first: `createdAt` desc, `id` desc). `nextCursor` is the last row's id
  when more remain, `null` on the last page. Never `OFFSET`.
- `buildApp()` accepts its probes and `ApiServices` as arguments, so tests drive
  the real Fastify pipeline through `app.inject()`.

## Test layout

| Path                          | Covers                                          |
| ----------------------------- | ----------------------------------------------- |
| `tests/unit/`                 | Pure logic and services over fakes              |
| `tests/integration/`          | `app.inject()`; API and real-PostgreSQL suites  |
| `tests/integration/database/` | Real PostgreSQL in a `<database>_test` database |
| `apps/web/tests/`             | Component/page tests against a stub API         |
| `e2e/`                        | Playwright specs; `webServer` starts both apps  |

SSE tests must bind a real socket (a hijacked stream cannot be driven through
`app.inject`) and use a short injected heartbeat interval — never real-time waits.

## Environment variables

| Variable            | Scope  | Purpose                                                             |
| ------------------- | ------ | ------------------------------------------------------------------- |
| `NODE_ENV`          | server | `development` \| `test` \| `production`                             |
| `API_PORT`          | server | Port the Fastify API listens on                                     |
| `DATABASE_URL`      | server | PostgreSQL connection string (`postgres://` scheme)                 |
| `CORS_ORIGINS`      | server | Comma-separated browser origins. Empty disables CORS (fails closed) |
| `LOG_LEVEL`         | server | `debug` \| `info` \| `warn` \| `error`                              |
| `TRUST_PROXY`       | server | Trust `X-Forwarded-*` headers                                       |
| `WEB_PORT`          | web    | Vite dev server port                                                |
| `VITE_API_BASE_URL` | client | Base URL the browser uses to reach the API                          |

`.env` is gitignored. Configuration is validated with Zod at startup; the API
refuses to boot on invalid configuration and reports variable _names_, never
values.

## CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`:
`npm ci` → `db:generate` → `lint` → `typecheck` → `test` → `db:migrate:deploy` →
`db:seed` → `build` → `test:e2e`. PostgreSQL is a service container with a
healthcheck; the CI database URL is an inline throwaway credential, so the
workflow needs no repository secret.

`.github/workflows/ai-loop-validate.yml` validates the AI development-loop
configuration and state. It is additive and does not replace CI.

## Phase scope

Implemented: 1 (foundation), 2 (database/domain/application/infrastructure),
3 (REST API), 4 (setup UI), 5 (group-stage scoring), 6 (knockout), 7 (courts,
scheduling, dashboard), 8.1–8.5 (realtime outbox, SSE, publishing, browser
client, live UI sync).

Not implemented: automatic draw/seeding, rankings, authentication,
authorization, result-correction workflows, Phase 8.6 multi-device hardening.

Do not add unimplemented phases unless the task explicitly asks for one.
