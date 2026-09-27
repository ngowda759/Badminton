# Phase 8 — Multi-device & realtime

Status: **Phase 8.1 implemented on `main`**; Phase 8.2–8.6 designed, not yet built.

This document covers the realtime layer that keeps several tournament devices
(laptop, tablet, phone) in sync while a tournament is operated. The authoritative
design remains [`phase-2-domain-design.md`](./phase-2-domain-design.md), the
layering is in [`phase-2-2-architecture.md`](./phase-2-2-architecture.md), the
HTTP surface in [`phase-3-rest-api.md`](./phase-3-rest-api.md), the operational
layer in [`phase-7-courts-dashboard.md`](./phase-7-courts-dashboard.md).

Realtime never becomes a second business-logic path. REST changes state,
PostgreSQL stores state, the outbox records what changed, SSE tells clients that
something changed, and clients refetch authoritative state.

## 1. Scope

- **In:** a durable transactional outbox, an event catalogue, a publisher, a
  dispatcher, and a PostgreSQL `LISTEN`/`NOTIFY` wake-up.
- **Out:** WebSockets, Redis, Kafka, RabbitMQ, background job platforms, event
  replay, authentication, and any client-side business logic. SSE (Phase 8.2) is
  the only transport; the browser refetches REST for state.

## 2. Layering

```
REST mutation
    ↓
Application service
    ↓  UnitOfWork.runInTransaction
PostgreSQL transaction: business change + realtime_events outbox row
    ↓  COMMIT
NOTIFY 'realtime_events' (commit only)
    ↓
Dispatcher drains outbox  →  RealtimeEventPublisher  →  SSE subscribers (8.2)
```

Business logic stays in services/domain; the outbox is written through a
repository port; Prisma never leaks into the application layer.

## 3. Phase 8.1 — implemented

### Domain (`packages/domain/src/realtime.ts`)

- `REALTIME_EVENT_TYPES`: `MATCH_SCHEDULED`, `MATCH_UNSCHEDULED`, `MATCH_STARTED`,
  `MATCH_GAME_RECORDED`, `MATCH_COMPLETED`, `MATCH_CANCELLED`, `COURT_CREATED`,
  `COURT_UPDATED`, `COURT_STATUS_CHANGED`, `KNOCKOUT_MATCH_POPULATED`.
- `REALTIME_AGGREGATE_TYPES`: `MATCH`, `COURT`.
- `RealtimeEvent` (id, tournamentId, eventType, aggregateType, aggregateId,
  occurredAt, payload, publishedAt), `isRealtimeEventType`,
  `isRealtimeAggregateType`, `normalizeRealtimePayload`,
  `RealtimeEventValidationError`.

The catalogue is intentionally small: an event is a meaningful, externally
observable state change, not every internal call. GETs, validation failures,
rejected transitions, failed transactions and unchanged updates never emit one.
Payloads stay flat maps of primitives — they are a notification, never a
replacement for the REST read model.

### Database

Forward-only migration `20260927180000_add_realtime_outbox` creates
`realtime_events` (`id`, `tournamentId`, `eventType`, `aggregateType`,
`aggregateId`, `payload` JSONB, `createdAt`, `publishedAt`), the
`(tournamentId, createdAt)` and `publishedAt` indexes, hand-written `CHECK`s
(non-empty catalogue columns, `publishedAt >= createdAt`), and the
`realtime_events_notify` trigger calling
`pg_notify('realtime_events', NEW."tournamentId")`. No historical migration or
Phase 1–7 table is touched.

### Application (`packages/application/src/realtime/`)

- `RealtimeEventRepository` port (in `repositories/index.ts`): `create(data)` on
  the caller's transactional client, plus dispatcher-side `getPendingEvents`
  (oldest first) and `markPublished` (idempotent, no-op when already published).
- `RealtimeEventService.record(client, data)` (`event.service.ts`): validates the
  catalogue and payload and writes the outbox row on the caller's client. It is
  the only way events are created.
- `RealtimeEventPublisher` (`publisher.ts`): in-memory subscription registry
  grouped by `tournamentId`, so a Tournament A event can never reach a
  Tournament B subscriber. A failing sink is isolated and reported, never
  re-thrown; no subscribers is not an error.
- `RealtimeDispatcher` (`dispatcher.ts`): polls the outbox, forwards each event to
  the publisher, and stamps `publishedAt` only after delivery — so a crash or
  failed publish leaves the row pending and it is retried (at-least-once).
  `wake()` drains immediately when NOTIFY fires. Serialised drains, a
  configurable interval, an injectable scheduler for tests, and errors reported
  through `onError` so the loop cannot crash the API.
- `RealtimeEventNotifier` (`notifier.ts`): cross-process wake-up port and the
  `REALTIME_NOTIFY_CHANNEL` constant.

### Infrastructure

- `toRealtimeEvent` mapper and `createRealtimeEventRepository` adapter (empty JSON
  object normalised back to `null`).
- `createPostgresRealtimeEventNotifier` (`realtime-notifier.ts`): a dedicated `pg`
  connection running `LISTEN`, reconnecting on failure. It uses one connection
  outside the Prisma pool so a long-lived `LISTEN` never occupies a pooled client.

### API

- `createRealtimeRuntime` (`apps/api/src/composition/realtime.ts`) builds the
  publisher, dispatcher and notifier and starts/stops them; `server.ts` starts it
  after the app is built and stops it during shutdown. There is **no** realtime
  route yet — the SSE endpoint is Phase 8.2.

### Configuration

`REALTIME_POLL_INTERVAL_MS` (default 1000) and
`REALTIME_HEARTBEAT_INTERVAL_MS` (default 15000) are validated in
`packages/config` and surfaced on `ApiConfig`; nothing is hard-coded.

## 4. Durability model

- **Atomic:** the business change and its event share one transaction. A rollback
  writes neither; multiple events for one operation (e.g. `MATCH_COMPLETED` +
  `KNOCKOUT_MATCH_POPULATED`) commit together.
- **Durable:** the outbox row survives a dispatcher crash or restart; the first
  drain after start recovers anything pending.
- **Cross-process:** NOTIFY is a wake-up only. A lost notification costs latency,
  never correctness, because the dispatcher also polls and the row remains.
- **Failure:** a delivery failure never rolls back the committed transaction.

## 5. Phase 8.2–8.6 (planned)

- **8.2** `GET /api/v1/tournaments/:tournamentId/events` — SSE transport,
  tournament scoping, heartbeat (`REALTIME_HEARTBEAT_INTERVAL_MS`), disconnect
  cleanup, `id:`/`event:`/`data:` framing.
- **8.3** application event publishing from `MatchSchedulingService`,
  `MatchResultService`, `CourtService`, `KnockoutProgressionService` — each state
  change writes its event inside the same transaction.
- **8.4** web `EventSource` client, connection state, query invalidation, REST
  refetch, graceful fallback to manual refresh.
- **8.5** live synchronization for dashboard, court board, scoring, standings and
  bracket — no duplicate domain logic.
- **8.6** multi-device/reconnect/missed-event/restart E2E hardening.

Until 8.4 lands, nothing changes for existing clients: manual refresh continues
to work and REST remains the only read path.
