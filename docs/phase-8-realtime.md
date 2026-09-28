# Phase 8 — Multi-device & realtime

Status: **Phase 8.1 (transactional outbox), Phase 8.2 (SSE transport), Phase 8.3
(application event publishing), Phase 8.4 (browser realtime client), Phase 8.5
(live UI synchronization) and Phase 8.6 (multi-device hardening and realtime
validation) implemented.**

- Phase 8.1 — Transactional Outbox — **IMPLEMENTED**
- Phase 8.2 — SSE Transport — **IMPLEMENTED**
- Phase 8.3 — Application event publishing — **IMPLEMENTED**
- Phase 8.4 — Web realtime client (`EventSource`) — **IMPLEMENTED**
- Phase 8.5 — Live UI sync — **IMPLEMENTED**
- Phase 8.6 — Multi-device hardening — **IMPLEMENTED**

Phase 8.6 adds no new architecture. It hardens and validates the Phase 8.1–8.5
implementation for tournament-day use across multiple devices and under
failure/concurrency: it fixes one connection-teardown race, adds structured
realtime logging, and adds deterministic automated and real-browser tests for
multi-client sync, tournament isolation, reconnect/missed-event recovery,
duplicate/out-of-order events, bursts, slow clients, dispatcher/NOTIFY fallback,
outbox atomicity and REST independence. The layering, ports and wire format are
unchanged.

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
  dispatcher, a PostgreSQL `LISTEN`/`NOTIFY` wake-up, the SSE transport endpoint
  (`GET /api/v1/tournaments/:tournamentId/events`) — Phase 8.1 + 8.2 — the
  application-service event publishing that writes the outbox rows — Phase 8.3 —
  the browser `EventSource` client that subscribes to that endpoint — Phase 8.4 —
  and the live UI synchronization that turns a delivered event into an
  authoritative REST refetch — Phase 8.5.
- **Out:** WebSockets, Redis, Kafka, RabbitMQ, background job platforms, event
  replay, authentication, and any client-side business logic. SSE is the only
  transport; the browser refetches REST for state. Phase 8.5 consumes the Phase
  8.4 signal to invalidate/refetch the REST queries the screens already own; it
  never derives state from an event payload, and a realtime outage leaves REST
  and manual refresh working.

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
repository port; Prisma never leaks into the application layer. Phase 8.3 is
where the top of that diagram is realized: the application services themselves
write the outbox row, and only the application services do.

## 3. Phase 8.1 — implemented

### Domain (`packages/domain/src/realtime.ts`)

- `REALTIME_EVENT_TYPES`: `MATCH_SCHEDULED`, `MATCH_UNSCHEDULED`, `MATCH_STARTED`,
  `MATCH_GAME_RECORDED`, `MATCH_RESULT_RECORDED`, `MATCH_COMPLETED`,
  `MATCH_CANCELLED`, `COURT_CREATED`, `COURT_UPDATED`, `COURT_STATUS_CHANGED`,
  `KNOCKOUT_MATCH_POPULATED`, `TOURNAMENT_STATUS_CHANGED`,
  `CATEGORY_STATUS_CHANGED`, `STAGE_STATUS_CHANGED`, `ENTRY_STATUS_CHANGED`.
  (Phase 8.3 added `MATCH_RESULT_RECORDED` and the four `*_STATUS_CHANGED`
  types; the catalogue still grows in `packages/domain`, never as scattered
  string literals — services use the `REALTIME_EVENTS` constants below.)
- `REALTIME_AGGREGATE_TYPES`: `MATCH`, `COURT`, `TOURNAMENT`, `CATEGORY`,
  `STAGE`, `ENTRY`.
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
(non-empty catalogue columns), and the `realtime_events_notify` trigger calling
`pg_notify('realtime_events', NEW."tournamentId")`. No historical migration or
Phase 1–7 table is touched.

There is deliberately **no** `publishedAt >= createdAt` check: `createdAt` comes
from the database clock and `publishedAt` from the API process clock, so
comparing them would make `markPublished()` fail whenever the API clock ran
behind PostgreSQL — leaving a successfully delivered event pending and causing a
duplicate retry. Pending semantics come from `publishedAt IS NULL`, not from
ordering.

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
  after the app is built and stops it during shutdown. It also passes the runtime
  into `buildApp`, which supplies the publisher to the SSE route (Phase 8.2).

### Configuration

`REALTIME_POLL_INTERVAL_MS` (default 1000) and
`REALTIME_HEARTBEAT_INTERVAL_MS` (default 15000) are validated in
`packages/config` and surfaced on `ApiConfig`; nothing is hard-coded.

## 4. Phase 8.2 — SSE transport (implemented)

### Endpoint

```
GET /api/v1/tournaments/:tournamentId/events
```

Opens a Server-Sent Events stream scoped to one tournament. The flow is exactly
the layering above: the route validates the path parameter, hijacks the HTTP
response, and hands it to a transport adapter that subscribes to the existing
Phase 8.1 `RealtimeEventPublisher`. The dispatcher forwards each committed outbox
row to the publisher, which delivers it only to that tournament's subscribers.

```
Browser / future client
        │
        ▼
GET /api/v1/tournaments/:tournamentId/events
        │
        ▼
Fastify SSE handler  (apps/api/src/http/routes/realtime.routes.ts)
        │
        ▼
RealtimeEventPublisher.subscribe(tournamentId, sink)
        │
        ▼
PostgreSQL outbox → dispatcher → publisher
        │
        ▼
SSE stream
```

### Response

The stream is standard SSE. An event frame is:

```
id: <event-id>
event: MATCH_COMPLETED
data: {"id":"<event-id>","event":"MATCH_COMPLETED","tournamentId":"...","aggregateType":"MATCH","aggregateId":"...","occurredAt":"...","payload":null}
```

`id` is the outbox row id, `event` is the existing Phase 8 event type (no second
event format is invented), and `data` is the existing `RealtimeEvent` shape.
Response headers are `Content-Type: text/event-stream`, `Cache-Control: no-cache`
and `Connection: keep-alive`.

The connection opens with a comment frame (`: connected`) and **no state
snapshot**: SSE never fabricates authoritative state. Recovery is a REST refetch.

### Heartbeat

A comment frame (`: heartbeat`) is written every `REALTIME_HEARTBEAT_INTERVAL_MS`
(no new configuration variable). A comment has no `event`/`data` fields, so a
client never dispatches it as a business event. The interval timer is `unref`-ed
so it does not keep the process alive, and it is cleared on disconnect and during
server shutdown.

### Subscription lifecycle

1. Validate `tournamentId` (before the response is hijacked, so a malformed id
   still gets the repository's normal `400`).
2. Hijack the response and write the SSE headers plus the open frame.
3. Subscribe the connection to the tournament through `RealtimeEventPublisher`
   (never a second registry).
4. Register cleanup on both the request and response `close` events.
5. Start the heartbeat.
6. On close: unsubscribe, clear the heartbeat, end the response, and drop the
   connection from the route's live-connection set. Cleanup is idempotent, so a
   close observed from two sides is safe and a disconnected client never remains
   in the publisher's registry.

### Tournament isolation

The publisher groups subscribers by `tournamentId`; a subscriber for tournament
A can never receive tournament B's event. The route does not query or broadcast
across tournaments.

### Failure isolation

A broken write to the response removes that sink and never throws into the
publisher or the request. A failed/disconnected client cannot crash Fastify, stop
the dispatcher, affect other subscribers, or affect REST. The route objects are
discarded and the process stays up; the publisher's existing per-sink isolation
is preserved.

### Backpressure

`send` is synchronous and never awaits the socket, so a slow client can never
block the publisher or the dispatcher. When `response.write` reports a full
socket, further frames are buffered (bounded by a byte cap) and flushed on
`drain`. A client that exceeds the cap is disconnected - SSE only signals
"something changed", so a stalled client reconnects and refetches REST instead of
forcing the server to buffer without bound. Memory stays bounded and other
subscribers are unaffected.

### Disconnect-initialization race

Disconnect detection is registered on the raw request and response **before**
anything is created, and the closed state is re-checked after subscribing and
after starting the heartbeat. A client that goes away at any point - before the
handler runs, while the headers are written, or mid-setup - always ends with no
subscription and no timer. A subscription created after a disconnect is undone
immediately, so a disconnected client can never remain in the publisher's
registry.

### Last-Event-ID

The endpoint accepts a `Last-Event-ID` request header for client compatibility,
but it is **informational only**: Phase 8.2 does not implement event replay. The
authoritative recovery mechanism after a reconnect is a REST refetch. There are
no replay queries and no event-history API.

### Server shutdown

The route registers a `preClose` hook that ends every live SSE stream, so
`app.close()` returns promptly rather than waiting on a stream that never closes
on its own. Fastify is built with `forceCloseConnections: 'idle'` to release idle
keep-alive sockets.

## 5. Durability model

- **Atomic:** the business change and its event share one transaction. A rollback
  writes neither; multiple events for one operation (e.g. `MATCH_COMPLETED` +
  `KNOCKOUT_MATCH_POPULATED`) commit together.
- **Durable:** the outbox row survives a dispatcher crash or restart; the first
  drain after start recovers anything pending.
- **Cross-process:** NOTIFY is a wake-up only. A lost notification costs latency,
  never correctness, because the dispatcher also polls and the row remains.
- **Failure:** a delivery failure never rolls back the committed transaction, and
  a broken SSE subscriber never affects another subscriber or REST.

## 6. Phase 8.3 — Application event publishing (implemented)

Phase 8.3 wires the existing application-layer tournament mutations to record a
realtime outbox row **inside the same `UnitOfWork.runInTransaction` block as the
business mutation**. Nothing new is introduced at the transport end: the same
`RealtimeEventService`, dispatcher, publisher and SSE endpoint from 8.1/8.2 carry
the events. Phase 8.3 only makes the services _produce_ them.

```
Application Service
        │
        ▼
UnitOfWork.runInTransaction(...)
        ├── business mutation (repositories)
        └── RealtimeEventService.record(client, …)
        ▼
      COMMIT  ──▶  realtime_events outbox  ──▶  dispatcher  ──▶  publisher  ──▶  SSE
```

### Transaction boundary

Every integrated mutation runs both writes on the **transaction-scoped
`RepositoryClient`** the unit of work hands it. Consequences, all covered by
tests:

- **Success** — the business change and its event(s) commit together.
- **Business failure** — the transaction rolls back, so no event is committed.
- **Event persistence failure** — the event write throws _inside_ the
  transaction, so the business change rolls back with it. Event recording is
  never caught-and-continued; it is not best-effort.

A mutation that previously used only the plain client (a single write) now opens
exactly one transaction so its event can join it. Read-only methods and
mutations that emit no event (see below) still open none.

### Event types used by each service

| Service                     | Mutation                              | Event(s) recorded                                                                                                     |
| --------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `MatchSchedulingService`    | `schedule`                            | `MATCH_SCHEDULED` (aggregate `MATCH`)                                                                                 |
| `MatchSchedulingService`    | `unschedule`                          | `MATCH_UNSCHEDULED` (aggregate `MATCH`)                                                                               |
| `MatchService`              | `transitionStatus` → `IN_PROGRESS`    | `MATCH_STARTED` (aggregate `MATCH`)                                                                                   |
| `MatchService`              | `transitionStatus` → `CANCELLED`      | `MATCH_CANCELLED` (aggregate `MATCH`)                                                                                 |
| `MatchResultService`        | `recordResult`                        | `MATCH_RESULT_RECORDED` + `MATCH_COMPLETED`; plus `KNOCKOUT_MATCH_POPULATED` when progression fills a next-round slot |
| `CourtService`              | `create`                              | `COURT_CREATED` (aggregate `COURT`)                                                                                   |
| `CourtService`              | `update`                              | `COURT_UPDATED` (aggregate `COURT`)                                                                                   |
| `CourtService`              | `transitionStatus`                    | `COURT_STATUS_CHANGED` (aggregate `COURT`)                                                                            |
| `TournamentService`         | `transitionStatus`                    | `TOURNAMENT_STATUS_CHANGED` (aggregate `TOURNAMENT`)                                                                  |
| `TournamentCategoryService` | `transitionStatus`                    | `CATEGORY_STATUS_CHANGED` (aggregate `CATEGORY`)                                                                      |
| `TournamentStageService`    | `transitionStatus`                    | `STAGE_STATUS_CHANGED` (aggregate `STAGE`)                                                                            |
| `TournamentEntryService`    | `confirm` / `withdraw` / `disqualify` | `ENTRY_STATUS_CHANGED` (aggregate `ENTRY`)                                                                            |

`KnockoutProgressionService` stays a pure bracket operation: it returns `true`
only when it actually fills a next-round slot, and `MatchResultService` uses that
signal to decide whether the `KNOCKOUT_MATCH_POPULATED` event is warranted. This
keeps a replayed/idempotent progression from producing a duplicate event without
adding a deduplication system.

The event-type and aggregate-type names are centralised in
`REALTIME_EVENTS` / `REALTIME_AGGREGATES`
(`packages/application/src/realtime/event-types.ts`), typed against the domain
catalogue, so a service never scatters a string literal.

### Payload principles

Every event carries `tournamentId`, `aggregateType`, `aggregateId` and
`eventType`, and an empty payload (`null` after normalisation). No dashboard,
match, standings or court object is embedded — the client refetches REST for
authoritative state, so the event is only a "something changed" notification. The
`tournamentId` is always resolved by the service that knows the aggregate (the
match → stage → category chain, the entry's category, the court/tournament id),
never derived from request or session state in the realtime layer.

### Idempotency / no-op behaviour

- A **no-op court status transition** (already in the target status) returns
  early and records nothing.
- A **rejected** mutation (invalid transition, duplicate number, overlap,
  inactive court, missing participant, …) throws before the event is written, so
  no event is committed.
- A **replayed knockout progression** returns `false`, so no duplicate
  `KNOCKOUT_MATCH_POPULATED` event is recorded.
- `recordResult` on an already-completed match is a conflict and records nothing.

### Which services intentionally do not publish

Only live-tournament state changes that a connected client would need to refetch
on produce an event. The following stay plain reads/single writes with no event,
to keep the catalogue meaningful and the transactions minimal:

- **Reads** — every `getById` / `list*` (dashboard, standings, bracket read,
  court list, …). The dashboard is a derived read model and never writes.
- **Creation and edits that are not live-state transitions** — tournament
  create/update, category create/update, stage create/update, player and team
  mutations, entry registration and seed edits. These do not change what is
  happening on court; a client that cares refetches on navigation.
- **`MatchService.create` / `update` / `addParticipant`** and
  **`KnockoutBracketService.generateBracket`**. Generating a bracket is setup,
  and participant assignment is not surfaced on the live dashboard; both are
  already transactional, and adding events would widen the catalogue without a
  client use case.
- **`CourtService` reads** and **`MatchService` reads** — never open a
  transaction.

If a later phase needs one of these, add the event to the domain catalogue and
the service's transaction; do not add speculative events now.

### Failure isolation

Application mutation success depends only on the outbox row committing with it.
It never depends on an SSE client: after commit, delivery is the dispatcher's and
publisher's concern (Phase 8.1/8.2), and a delivery failure never rolls anything
back. The application layer records durable events; it never sends SSE, never
calls the publisher, and never holds an HTTP/SSE dependency.

## 7. Phase 8.4 — Browser realtime client (implemented)

Phase 8.4 adds the browser-side SSE client. It opens a tournament-scoped
`EventSource`, tracks the connection lifecycle, parses each event frame, and
hands the parsed event to a consumer. It is a **signal source only**: it never
fetches dashboard data, never mutates state, never calls a REST endpoint and
never decides which query to invalidate. That wiring is Phase 8.5.

```
React UI
   │
   ▼
useTournamentRealtime(tournamentId)   (apps/web/src/realtime/use-tournament-realtime.ts)
   │
   ▼
createTournamentRealtimeClient        (apps/web/src/realtime/realtime-client.ts)
   │
   ▼
EventSource
   │
   ▼
GET /api/v1/tournaments/:tournamentId/events
```

### Location and layering

`apps/web/src/realtime/`:

- `realtime-types.ts` — the `RealtimeConnectionStatus` union, the client-side
  `RealtimeEvent`, and `parseRealtimeEvent` (JSON parse plus the shared Zod
  envelope guard).
- `realtime-client.ts` — the framework-free lifecycle client
  (`createTournamentRealtimeClient`, `buildTournamentEventsUrl`,
  `RealtimeEventSource`, `EventSourceFactory`). No React import, so it is unit
  testable against a fake `EventSource`.
- `use-tournament-realtime.ts` — the React binding. One `EventSource` per mount,
  closed on unmount and on tournament change.

The envelope guard itself lives in the shared `@badminton/validation` package
(`realtimeEventEnvelopeSchema` / `parseRealtimeEventEnvelope`), alongside
`healthResponseSchema`, so the browser validates the server contract with the
same Zod tooling the REST client already uses rather than a second copy.

### Public API

```ts
const { status, lastEvent } = useTournamentRealtime(tournamentId, {
  onEvent: (event) => {
    /* Phase 8.5 will invalidate/refetch REST here */
  },
});
```

`status` is the connection state; `lastEvent` is the most recent event for the
current tournament (or `null`); `onEvent` is called for every well-formed event.
The hook is the only realtime API the UI consumes; a future Phase 8.5 consumer
subscribes through it rather than touching the client or `EventSource`.

### Connection states

```
initial
  ↓
CONNECTING        start() opened the EventSource
  ↓  open
CONNECTED         stream is live
  ↓  error (temporary)
RECONNECTING      the browser is retrying on its own
  ↓  open
CONNECTED
  ↓  stop() / unmount / error while CLOSED
DISCONNECTED      intentional; no further callbacks
```

The statuses are a typed union, not arbitrary strings. A _temporary_ error while
the source is still retrying is `RECONNECTING`; a source that reports `CLOSED`
(readyState `2`) has given up and is `DISCONNECTED`. An explicit `stop()` or
unmount is always `DISCONNECTED`, never confused with a transient failure.

### Reconnection

Reconnection uses the browser's native `EventSource` retry. There is **no custom
reconnect loop**, so no second connection is ever created: the client only
mirrors the browser's own state (an error while not `CLOSED` is `RECONNECTING`).
A consumer that wants to recover authoritative state after a reconnect does so
with a REST refetch (Phase 8.5), not by replaying events.

### Event parsing

The `data` field of a frame is parsed with `JSON.parse` and then validated
against the envelope (`id`, `event`, `tournamentId`, `aggregateType`,
`aggregateId`, `occurredAt` non-empty strings; `payload` opaque). A malformed
frame — invalid JSON, missing or empty fields, a non-string `data` — is dropped
and the connection stays open. An event whose type the client does not know is
still delivered as long as the envelope is valid, so a later server release that
adds an event does not break an older client. The client never branches on the
event type; it only signals that something changed.

### Lifecycle and cleanup

`start()` is a no-op while a source exists, so a double effect invocation (React
Strict Mode in development) can never open two sockets — there is **at most one
active `EventSource` per client instance**. `stop()` detaches the `onopen` /
`onerror` / `onmessage` handlers _before_ calling `close()`, so no callback fires
after disposal, and it is idempotent. Unmounting the hook, or changing the
tournament id, closes the old connection first and only then opens the new one,
so the previous tournament's stream is never left active.

### Tournament scoping and no replay

The URL is built once per tournament and the id is path-encoded
(`/api/v1/tournaments/<id>/events`); the client never opens a global stream and
never subscribes to more than one tournament. An absent or malformed id (not a
UUID, per `tournamentIdSchema`) opens no connection at all. Phase 8.2 does not
replay and the client does not ask for `Last-Event-ID`; missed events are not
reconstructed — a reconnect is only a signal for a consumer to refetch REST.

### Relationship to Phase 8.5

Phase 8.4 deliberately stops at the signal. `apps/web/src/realtime/tournament-refresh.tsx`
(Phase 8.5) is the consumer that turns `onEvent` / `status` into an authoritative
REST refetch. Because the server frames every event with a named `event:` field,
the client subscribes to each catalogue type with `addEventListener`; a named
frame is never delivered to `onmessage`, so a single `onmessage` handler would
silently receive nothing from the real server.

## 8. Phase 8.5 — Live UI synchronization (implemented)

Phase 8.5 connects the Phase 8.4 signal to the REST queries the screens already
own. It is the only place a realtime event is allowed to affect the UI, and it
does so by invalidating/refetching REST — never by reading `event.payload` as a
read model.

```
SSE event  ─┐
            ├─► TournamentRealtimeProvider ─► refresh bus ─► useTournamentRefresh(refetch)
reconnect  ─┘                                                    │
                                                                 ▼
                                             existing REST query (useApiQuery) refetches
                                                                 │
                                                                 ▼
                                                       React re-renders REST data
```

### Location and layering

`apps/web/src/realtime/tournament-refresh.tsx`:

- `TournamentRealtimeProvider` — one per open tournament, mounted by
  `TournamentLayout`. It is the **single** `useTournamentRealtime` consumer for
  the whole subtree, so exactly one `EventSource` is opened no matter how many
  screens register a query. It owns two refresh triggers and nothing else: a
  delivered event, and a reconnect after the connection was lost.
- `useTournamentRefresh(refetch)` — called by each screen with the `refetch` of
  the query that owns its authoritative data. It registers the listener with a
  stable callback that reads the latest `refetch` from a ref, so a rerender with
  a new inline function never re-subscribes and Strict Mode's double effect only
  subscribes/unsubscribes once.
- `RealtimeStatusIndicator` — a small non-blocking hint (`Live`,
  `Reconnecting…`, `Offline`); it renders nothing outside a tournament stream.

The bus is deliberately **not a store**: it holds no tournament state, never
inspects an event payload and never merges an event into a read model. An event
and a reconnect both resolve to the same action — "refetch REST" — so the REST
response stays the single source of truth and the client never needs to
understand the domain event catalogue. Any valid tournament event refreshes the
affected query; there is no `switch (event.event)` and no per-event business
logic, which keeps the frontend forward-compatible with future event types.

### Request coalescing

One user action can emit several events in the same committed transaction
(recording a result emits `MATCH_RESULT_RECORDED` + `MATCH_COMPLETED`, often with
`KNOCKOUT_MATCH_POPULATED`), delivered as several SSE frames. A single
`DEFAULT_REFRESH_COALESCE_MS` (60 ms) window collapses the burst into one
authoritative refetch. The window is **not** reset by later events, so a
sustained stream still bounds latency to one window; the pending flush is
cancelled on unmount, so nothing refetches after the screen is gone.

### Reconnect

The first `CONNECTED` is the initial subscription, and the screen already has its
authoritative REST data from the initial load, so it does **not** refetch (this
avoids duplicating the initial request). Any later `CONNECTED` follows a
`RECONNECTING`/`DISCONNECTED`, where events may have been missed; because Phase
8.2 does not replay, that reconnect triggers an authoritative refresh. Missed
events are never reconstructed from the stream.

### Failure isolation and scope

Realtime is optional from a business perspective: the initial REST load,
manual refresh, and every REST path work with the stream unavailable. A
malformed frame is dropped by Phase 8.4 and never reaches the UI. A failed
realtime-triggered refetch surfaces through the screen's existing error state —
no new global error system. Invalidation is tournament-scoped (one provider per
tournament, one `EventSource` per provider), so an event for tournament A never
refreshes tournament B; there is no global `invalidateQueries()`.

### Screens synchronized

`useTournamentRefresh` is wired into the dashboard, court board, courts
management, match detail / scoring, stage detail (group standings), the knockout
bracket, categories, stages and entries — each through its own existing
`useApiQuery` REST read. No screen computes standings, scores, winners or bracket
progression in the browser.

## 9. Phase 8.6 — Multi-device hardening (implemented)

Phase 8.6 validates and hardens the existing implementation for tournament-day
use across several browsers/devices and under failure/concurrency. It introduces
**no new architecture**: REST still changes state, PostgreSQL stores it, the
outbox records what changed, SSE notifies, and the browser refetches. No Redis,
Kafka, RabbitMQ, BullMQ, WebSockets, external realtime service, authentication or
event replay is added, and no historical migration is modified.

### Fixes

- **Route teardown race (real defect).** `openSseConnection` may close
  *synchronously during setup* when the client is already gone, so its
  `onCleanup` could fire while the route was still evaluating
  `const connection = openSseConnection(...)`. Reading that binding inside
  `onCleanup` then threw a temporal-dead-zone `ReferenceError`, which the error
  handler turned into a `500` for a client that had simply disconnected. The
  route now holds the connection in a small mutable box and registers cleanup
  before opening the stream, so a setup-time close is removed from the live set
  without touching an uninitialised binding. Covered by
  `tests/unit/api/realtime-routes.test.ts`, which fails with the
  `ReferenceError` against the pre-fix route.
- **Realtime observability.** The SSE route logs `SSE connection opened` /
  `SSE connection closed` (tournament id only), the API logs
  `realtime dispatcher started` with the poll interval, and dispatcher/publisher/
  notifier failures (including a `LISTEN` connection error) are routed to the
  app's redacting logger as `realtime error`. No payloads, request bodies or
  credentials are logged.

### Validated properties (and where they are pinned)

| Property                                | Evidence                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------- |
| Multi-client synchronization            | `e2e/phase8-live-sync.spec.ts`; publisher fan-out in `realtime.test.ts`     |
| Tournament isolation                    | `e2e/phase8-6-hardening.spec.ts`, SSE route + publisher tests, web tests    |
| Reconnect → REST refresh                | `e2e/phase8-6-hardening.spec.ts`, `live-sync-hardening.test.tsx`            |
| Missed events → authoritative recovery  | `e2e/phase8-6-hardening.spec.ts`, `live-sync-hardening.test.tsx`            |
| Duplicate / out-of-order events         | `live-sync-hardening.test.tsx`                                              |
| Rapid event bursts (request storm)      | `e2e/phase8-6-hardening.spec.ts`, `live-sync-hardening.test.tsx`            |
| Slow-client isolation (bounded buffer)  | `sse-connection.test.ts`                                                    |
| REST failure after a realtime event     | `live-sync-hardening.test.tsx`                                              |
| Realtime unavailable → REST unaffected  | `e2e/phase8-6-hardening.spec.ts`, `live-sync-hardening.test.tsx`            |
| SSE cleanup / no leaks                  | `sse-connection.test.ts`, SSE route tests, `live-sync-hardening.test.tsx`   |
| Dispatcher recovery / NOTIFY fallback   | `realtime-hardening.test.ts`, `realtime-outbox-database.test.ts`            |
| Outbox durability / atomicity           | `realtime.test.ts`, `realtime-outbox-database.test.ts`                      |
| Concurrent drains, load, indexes        | `realtime-hardening-database.test.ts`                                       |
| React Strict Mode single connection     | `use-tournament-realtime.test.tsx`                                          |

### Notes and deliberate limits

- **Duplicate delivery is harmless by design.** The dispatcher serialises drains
  and stamps `publishedAt` only after delivery; it is at-least-once. A duplicate
  event only causes another authoritative REST refetch, which is idempotent
  (coalesced and payload-independent), so no client-side domain logic is added.
- **Ordering is not client state.** The provider never reads an event payload,
  never sequences events and never reconstructs state, so an out-of-order
  redelivery cannot corrupt the UI. No `sequenceNumber`/`previousEventId`/
  replay system is introduced.
- **NOTIFY is a wake-up, not transport.** A missed notification is recovered by
  the poll (`realtime-hardening.test.ts` proves processing with no `wake()`);
  the durable row remains the source of truth.
- **Slow-client backpressure** stays at the existing 1 MiB bounded buffer; the
  Phase 8.6 slow-client tests pass against it, so no change was warranted.
- **Database indexes** `(tournamentId, createdAt)` and `(publishedAt)` already
  cover the only two realtime query paths (pending drain and tournament
  history), so no new index or migration was added. The presence of both indexes
  is asserted in `realtime-hardening-database.test.ts`.
- **Server restart** is covered as far as the local infrastructure allows: the
  dispatcher's pending-row recovery on `start()` is tested at the application and
  database level, and the browser reconnect path is tested in a real browser.
  Playwright's `webServer` cannot restart the API mid-test, so a true
  process-restart E2E is not automated; the reconnect test exercises the same
  client recovery (lost stream → native retry → authoritative refetch) that a
  restart produces, and missed events are recovered by the reconnect refetch.

Realtime remains a notification channel only: REST changes state, PostgreSQL
stores it, the outbox records what changed, SSE tells clients to refetch, and the
browser renders the authoritative REST response. If SSE fails, REST and manual
refresh keep working.
