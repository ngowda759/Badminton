# AGENTS.md

Repository guidance for automated agents working on Badminton V2.

## What this repository is

Badminton V2 — a badminton tournament management platform. **Phase 1 (foundation) is
complete; tournament features are not implemented.** Do not add tournament models,
routes, UI or schemas unless the task explicitly asks for a later phase.

## Layout

- `apps/api` — Fastify API. `app.ts` is the factory, `server.ts` owns `listen`.
- `apps/web` — React 19 + Vite + Tailwind v4 + shadcn/ui.
- `packages/domain` — types/contracts only, no runtime dependencies.
- `packages/validation` — shared Zod schemas and `parseRequest`.
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
- Prisma 7 resolves `env('DATABASE_URL')` eagerly when `prisma.config.ts` is imported, so
  that file loads `dotenv` itself before calling `defineConfig`.
- Prisma generates into `packages/database/generated/prisma`, which is gitignored. Run
  `npm run db:generate` after a fresh clone.
- The seed is idempotent (upserts on `key`); never replace it with `create`.
