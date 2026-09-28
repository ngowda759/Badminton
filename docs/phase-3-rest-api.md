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
| `POST`   | `/api/v1/tournaments`                          | tournaments |
| `GET`    | `/api/v1/tournaments/:id`                      | tournaments |
| `PATCH`  | `/api/v1/tournaments/:id`                      | tournaments |
| `POST`   | `/api/v1/tournaments/:id/transition`           | tournaments |
| `GET`    | `/api/v1/tournaments/:tournamentId/categories` | categories  |
| `POST`   | `/api/v1/tournaments/:tournamentId/categories` | categories  |
| `GET`    | `/api/v1/categories/:id`                       | categories  |
| `PATCH`  | `/api/v1/categories/:id`                       | categories  |
| `POST`   | `/api/v1/categories/:id/transition`            | categories  |
| `POST`   | `/api/v1/players`                              | players     |
| `GET`    | `/api/v1/players/:id`                          | players     |
| `PATCH`  | `/api/v1/players/:id`                          | players     |
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

Only operations already supported by the Phase 2 services are exposed. Listing
tournaments across the collection is **not** implemented, because the
application layer does not provide it; no new query system was invented for the
API.

`GET /api/v1/tournaments/:tournamentId/events` is the Phase 8.2 realtime
endpoint; it is a Server-Sent Events stream rather than a JSON resource and is
documented in [`phase-8-realtime.md`](./phase-8-realtime.md). It is a
notification channel only — REST remains authoritative.

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

Collection:

```json
{ "data": [] }
```

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
