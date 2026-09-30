# Phase 3 — REST API

Status: implemented on `feature/phase-3-api`.

This document describes the HTTP surface added in Phase 3. It exposes the
existing Phase 2 application services through Fastify. The authoritative domain
design remains [`phase-2-domain-design.md`](./phase-2-domain-design.md), and the
Phase 2.2 layer is described in [`phase-2-2-architecture.md`](./phase-2-2-architecture.md).

Phase 3 adds **no database changes**: no schema edit, no new migration. It is a
pure HTTP layer over the services that already existed.

## 1. Layering

```
HTTP Client
    │
    ▼
Fastify  (apps/api/src/app.ts — buildApp)
    │
    ▼
API routes  (apps/api/src/http/routes)
    │  route params / body validated with Zod
    ▼
Application services  (@badminton/application)
    │
    ▼
Domain rules  (@badminton/domain)
    │
    ▼
Repository ports  (@badminton/application)
    │
    ▼
Prisma infrastructure  (@badminton/infrastructure)
    │
    ▼
PostgreSQL
```

Route handlers **parse, validate, delegate and map**. They contain no business
logic, never import Prisma and never open a transaction. Every decision -
lifecycle reachability, category format versus competitor, doubles team size,
duplicate registration, player-in-two-teams, participant eligibility - is made by
the application/domain layer.

## 2. Composition

`buildApp(options)` is the application factory. It returns a fully wired Fastify
instance and does **not** bind a socket, so tests drive it with `app.inject()`.

```ts
buildApp({
  checks, // health probes (Phase 1)
  corsOrigins, // CORS allowlist
  services, // ApiServices — the /api/v1 application services
  logger, // Fastify logger option
  trustProxy, // whether to trust X-Forwarded-* headers
});
```

- `services` is optional. When omitted (as in the Phase 1 health tests) the app
  registers `/health` only and no `/api/v1` routes.
- `server.ts` owns `listen` and the shutdown sequence. It builds the single
  Prisma client, adapts it to a repository client and unit of work
  (`@badminton/infrastructure`), and passes the resulting `ApiServices` to
  `buildApp`.

Startup is separate from construction:

```
buildApp()  →  app.listen()  →  SIGINT/SIGTERM  →  app.close() → prisma.$disconnect()
```

## 3. Base URL and versioning

- Base URL: `http://<host>:<API_PORT>` (default `http://localhost:3000`).
- Tournament-domain endpoints are under `/api/v1`.
- `GET /health` is **unchanged** and stays unversioned, matching the existing
  project convention.

## 4. Endpoints

| Method   | Path                                           | Service     |
| -------- | ---------------------------------------------- | ----------- |
| `GET`    | `/api/v1/tournaments`                          | tournaments |
| `POST`   | `/api/v1/tournaments`                          | tournaments |
| `GET`    | `/api/v1/tournaments/:id`                      | tournaments |
| `PATCH`  | `/api/v1/tournaments/:id`                      | tournaments |
| `POST`   | `/api/v1/tournaments/:id/transition`           | tournaments |
| `GET`    | `/api/v1/tournaments/:tournamentId/categories` | categories  |
| `POST`   | `/api/v1/tournaments/:tournamentId/categories` | categories  |
| `GET`    | `/api/v1/categories/:id`                       | categories  |
| `PATCH`  | `/api/v1/categories/:id`                       | categories  |
| `POST`   | `/api/v1/categories/:id/transition`            | categories  |
| `GET`    | `/api/v1/players`                              | players     |
| `POST`   | `/api/v1/players`                              | players     |
| `GET`    | `/api/v1/players/:id`                          | players     |
| `PATCH`  | `/api/v1/players/:id`                          | players     |
| `GET`    | `/api/v1/teams`                                | teams       |
| `POST`   | `/api/v1/teams`                                | teams       |
| `GET`    | `/api/v1/teams/:id`                            | teams       |
| `PATCH`  | `/api/v1/teams/:id`                            | teams       |
| `GET`    | `/api/v1/teams/:id/members`                    | teams       |
| `POST`   | `/api/v1/teams/:id/members`                    | teams       |
| `DELETE` | `/api/v1/teams/:id/members/:playerId`          | teams       |
| `GET`    | `/api/v1/categories/:categoryId/entries`       | entries     |
| `POST`   | `/api/v1/categories/:categoryId/entries`       | entries     |
| `GET`    | `/api/v1/entries/:id`                          | entries     |
| `PATCH`  | `/api/v1/entries/:id`                          | entries     |
| `POST`   | `/api/v1/entries/:id/confirm`                  | entries     |
| `POST`   | `/api/v1/entries/:id/withdraw`                 | entries     |
| `POST`   | `/api/v1/entries/:id/disqualify`               | entries     |
| `GET`    | `/api/v1/categories/:categoryId/stages`        | stages      |
| `POST`   | `/api/v1/categories/:categoryId/stages`        | stages      |
| `GET`    | `/api/v1/stages/:id`                           | stages      |
| `PATCH`  | `/api/v1/stages/:id`                           | stages      |
| `POST`   | `/api/v1/stages/:id/transition`                | stages      |
| `GET`    | `/api/v1/stages/:stageId/matches`              | matches     |
| `POST`   | `/api/v1/stages/:stageId/matches`              | matches     |
| `GET`    | `/api/v1/matches/:id`                          | matches     |
| `PATCH`  | `/api/v1/matches/:id`                          | matches     |
| `POST`   | `/api/v1/matches/:id/transition`               | matches     |
| `GET`    | `/api/v1/matches/:matchId/participants`        | matches     |
| `POST`   | `/api/v1/matches/:matchId/participants`        | matches     |

Only operations already supported by the application layer are exposed. The
`GET` collection endpoints (`/tournaments`, `/players`, `/teams`) are
cursor-paginated list reads; the application services gained matching `list`
methods rather than the API inventing a query system of its own.

`GET /api/v1/tournaments/:tournamentId/events` is the Phase 8.2 realtime
endpoint; it is a Server-Sent Events stream rather than a JSON resource and is
documented in [`phase-8-realtime.md`](./phase-8-realtime.md). It is a
notification channel only — REST remains authoritative.

### Collection endpoints

`GET /api/v1/tournaments`, `GET /api/v1/players` and `GET /api/v1/teams` return
one page of a persisted collection so the web UI lists records from the
database instead of browser session storage.

Query parameters (all optional):

| Parameter | Type    | Default | Notes                                                        |
| --------- | ------- | ------- | ------------------------------------------------------------ |
| `limit`   | integer | `20`    | 1–100 inclusive; a value outside the range fails with `400`. |
| `cursor`  | UUID    | —       | Opaque cursor from the previous page's `nextCursor`.         |

Response:

```json
{ "data": { "items": [{ "id": "…" }], "nextCursor": "…" } }
```

`nextCursor` is the last returned row's id when more rows remain, or `null` on
the last page; pass it back as `cursor` to fetch the next page. Pagination is
cursor-based, never `OFFSET`-scanned: the repository issues one `findMany` with
`take: limit + 1` (the extra row proves whether another page exists) and Prisma
expands `cursor: { id }` into a **keyset predicate over the whole ordering
tuple**. For the `(createdAt desc, id desc)` order that predicate compares the
cursor row's `createdAt` and `id`, so a page resumes strictly after the cursor
even when `createdAt` values differ or tie:

```sql
WHERE (("createdAt" = (SELECT "createdAt" … WHERE id = $cursor)
        AND "id" <= (SELECT "id" … WHERE id = $cursor))
   OR  ("createdAt" < (SELECT "createdAt" … WHERE id = $cursor)))
ORDER BY "createdAt" DESC, "id" DESC
LIMIT $take OFFSET $skip   -- $skip is only ever 0 or 1
```

The `id desc` tiebreaker is load-bearing: without it Prisma emits a non-unique
`createdAt <= cursor` comparison whose result depends on physical row order, so
rows can be skipped or repeated at a page boundary that falls inside a timestamp
tie. This behaviour is covered by `tests/integration/database/collection-pagination-database.test.ts`
against real PostgreSQL.

Ordering is deterministic and newest first for every collection:

- Tournaments — `createdAt` descending, `id` descending.
- Players — `createdAt` descending, `id` descending.
- Teams — `createdAt` descending, `id` descending.

Newest-first ordering keeps a freshly created record on the first page, so the
create → list flow shows it immediately without paging.

List DTOs expose only operator-facing fields:

| Collection  | Fields                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| Tournaments | `id`, `name`, `description`, `status`, `startDate`, `endDate`, `location`, `timezone`, `createdAt`, `updatedAt` |
| Players     | `id`, `name`, `email`, `phone`, `createdAt`, `updatedAt`                                                        |
| Teams       | `id`, `name`, `memberCount`, `createdAt`, `updatedAt`                                                           |

`memberCount` is a derived count over the page's team ids in one grouped read,
so listing teams never issues a query per team (no N+1).

### Lifecycle

| Aggregate  | Endpoint                                                 | Body                                 |
| ---------- | -------------------------------------------------------- | ------------------------------------ |
| Tournament | `POST /api/v1/tournaments/:id/transition`                | `{ "status": "<TournamentStatus>" }` |
| Category   | `POST /api/v1/categories/:id/transition`                 | `{ "status": "<CategoryStatus>" }`   |
| Stage      | `POST /api/v1/stages/:id/transition`                     | `{ "status": "<StageStatus>" }`      |
| Match      | `POST /api/v1/matches/:id/transition`                    | `{ "status": "<MatchStatus>" }`      |
| Entry      | `POST /api/v1/entries/:id/confirm\|withdraw\|disqualify` | —                                    |

Whether a transition is allowed is decided by the domain lifecycle tables; an
illegal transition returns `409` with code `INVALID_STATE_TRANSITION`.

## 5. Request validation

Every request boundary is validated with the shared Zod schemas in
`@badminton/validation`, before an application service is called:

- **Body** for `POST`/`PATCH`.
- **Path parameters** (`:id`, `:tournamentId`, …) as UUIDs.
- Values are normalized the same way the application layer expects (category
  code upper-cased, email lower-cased, calendar dates to UTC midnight).

A failure produces `400` with field paths; the service is never reached. Route
handlers do not parse HTTP strings themselves.

## 6. Response conventions

Single resource:

```json
{ "data": { "id": "…", "…": "…" } }
```

Collection (cursor-paginated, Phase "collection APIs"):

```json
{ "data": { "items": [], "nextCursor": null } }
```

Nested collections that are fully owned by a parent (a tournament's categories,
a category's stages, a match's participants) remain plain arrays
(`{ "data": [] }`) because they are bounded and not independently paginated.

Status codes: `201` on create, `200` on read/update/transition, `204` on member
removal (the only bodyless operation). All JSON responses use
`application/json`.

## 7. Error format

One consistent envelope for every error:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed.", "details": [] } }
```

Field-level validation failure:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": [{ "path": "name", "message": "Name must not be empty." }]
  }
}
```

Unknown route:

```json
{ "error": { "code": "NOT_FOUND", "message": "Route GET /api/v1/nope not found." } }
```

### Error mapping

| Domain/application error      | HTTP | Code                       |
| ----------------------------- | ---- | -------------------------- |
| `RequestValidationError`      | 400  | `VALIDATION_ERROR`         |
| `ValidationError`             | 400  | `VALIDATION_ERROR`         |
| `NotFoundError`               | 404  | `NOT_FOUND`                |
| `ConflictError`               | 409  | `CONFLICT`                 |
| `InvalidStateTransitionError` | 409  | `INVALID_STATE_TRANSITION` |
| `BusinessRuleViolationError`  | 422  | `BUSINESS_RULE_VIOLATION`  |
| `PersistenceError`            | 500  | `PERSISTENCE_ERROR`        |
| any other error               | 500  | `INTERNAL_SERVER_ERROR`    |

Internal detail never reaches the client: Prisma/SQL errors, connection strings,
stack traces and file paths are logged but replaced with a generic message.
Malformed JSON is handled by the same central error handler and returns `400`.

## 8. Configuration

Phase 3 adds no new configuration variables. The API reuses the existing
Zod-validated server environment:

| Variable       | Default      | Purpose                                       |
| -------------- | ------------ | --------------------------------------------- |
| `API_PORT`     | `3000`       | Port the API listens on                       |
| `DATABASE_URL` | — (required) | PostgreSQL connection string                  |
| `CORS_ORIGINS` | `''`         | Browser origin allowlist; empty disables CORS |
| `LOG_LEVEL`    | `info`       | `debug` \| `info` \| `warn` \| `error`        |
| `TRUST_PROXY`  | `false`      | Whether to trust `X-Forwarded-*` headers      |

CORS is configuration-driven and fails closed: an empty allowlist disables CORS
rather than falling back to a wildcard. The logger redacts `DATABASE_URL`,
`databaseUrl`, `connectionString`, `password`, `authorization` and `cookie`.

## 9. Testing

- **Route tests** (`tests/integration/api/routes.test.ts`) build the real Fastify
  app with the real application services over in-memory repository fakes,
  driven through `app.inject()`. They assert the HTTP contract: status
  codes, envelopes, validation at the boundary, and error mapping.
- **Vertical-slice tests** (`tests/integration/api/vertical-slice.test.ts`) run
  HTTP → Fastify → service → repository → Prisma → **real PostgreSQL** in a
  dedicated `<database>_api_test` database. They cover the flows whose value is
  end-to-end and confirm rows actually persist.
- Phase 1 and Phase 2 suites are unchanged and continue to pass.

Database-backed suites skip when PostgreSQL is unreachable and fail the run
under `CI` or `REQUIRE_DATABASE_TESTS=1`.

## 10. Out of scope

No authentication, authorization, users, roles or permissions. No UI changes,
draw generation, scoring, standings, ranking, scheduling, courts or venues,
realtime, notifications, payments, analytics or file uploads. No OpenAPI/Swagger
(the API is documented here in Markdown instead). No schema or migration
changes.
