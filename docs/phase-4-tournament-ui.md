# Phase 4 — Tournament Setup UI

Phase 4 adds the first functional tournament-management user interface to
Badminton V2. It is an administrative tool for **setting up** a tournament:
creating tournaments, categories, players and teams, registering entries, and
managing stage and match metadata.

Scoring, draw/bracket generation, standings, ranking, scheduling and live play
are **out of scope**. See [Out of scope](#out-of-scope).

## Architecture

The browser talks to the REST API and nothing else:

```
React UI
  ↓  pages
  ↓  components
  ↓  API hooks / services
  ↓  API client  (apps/web/src/api/client.ts)
  ↓  HTTP  /api/v1
Fastify
  ↓
Application services
  ↓
Domain
  ↓
PostgreSQL
```

`apps/web` may import `@badminton/domain` (pure types and lifecycle tables) and
`@badminton/config` (client configuration) only. It never imports Prisma,
`@badminton/infrastructure` or `@badminton/database`, and never connects to
PostgreSQL.

## API client and configuration

The HTTP layer is centralized under `apps/web/src/api/`:

| File          | Responsibility                                                 |
| ------------- | -------------------------------------------------------------- |
| `client.ts`   | Base URL, headers, JSON parsing, error translation, `ApiError` |
| `services.ts` | Typed domain methods (`tournaments`, `categories`, …)          |
| `types.ts`    | Serialized DTOs mirroring the Phase 3 REST contract            |
| `context.tsx` | `ApiProvider` / `useApi` so pages are testable against a stub  |
| `index.ts`    | The single application client instance                         |

Components never call `fetch` directly; they use `useApi()` and the typed
services. The `ApiError` type carries `status`, `code`, `message` and `details`
and is the only failure shape the UI displays — network failures, malformed
bodies and 5xx responses are normalized into safe, user-facing messages. Raw
Prisma/SQL/stack detail is never shown.

### `VITE_API_BASE_URL`

The base URL comes from `VITE_API_BASE_URL` (validated in `@badminton/config`),
with a local default of `http://localhost:3000`. Only public API configuration
may live in a `VITE_`-prefixed variable — never secrets or database credentials.
See `.env.example`.

## Running locally

```bash
cp .env.example .env          # sets VITE_API_BASE_URL and DATABASE_URL
docker compose up -d postgres
npm install
npm run db:generate && npm run db:migrate && npm run db:seed
npm run dev                   # API on :3000, web on :5173
```

Open `http://localhost:5173`. (`localhost` and `127.0.0.1` are distinct browser
origins; both are in the default `CORS_ORIGINS`.)

## Routes

Routing uses React Router (`apps/web/src/routes.tsx`). The tree is
tournament-centric:

```
/tournaments                     entry point + recent tournaments + open by ID
/tournaments/new                 create tournament
/tournaments/:tournamentId       details, lifecycle, setup links
  /edit                          edit tournament
  /categories                    category list
  /categories/new                create category
  /categories/:categoryId        category details + lifecycle + inline edit
    /entries                     entries list, registration, lifecycle
    /stages                      stage list + create
    /stages/:stageId             stage details, lifecycle, edit, match list + create
    /matches/:matchId            match details, lifecycle, edit, participant slots
  /players                       scoped player list (same page as global)
  /teams                         scoped team list (same page as global)
/players                         player create + recents + open by ID
/players/:playerId               player details + edit
/teams                           team create + recents + open by ID
/teams/:teamId                   team details, rename, member add/remove
/status                          Phase 1 API/database health panel
```

Tournament and category layouts load their record once and share it with nested
routes, so navigating between child pages does not refetch it.

## Application shell and design

`AppShell` provides the header, primary navigation (Tournaments, Players, Teams,
Status) and content area. Navigation collapses on mobile, tables scroll horizontally
rather than overflowing, and forms stack on small screens. Status is shown with
consistent `StatusBadge`s driven by one presentation table, so a status never
means different things on different pages.

Reusable pieces live in `apps/web/src/components/`: `StatusBadge`, `LoadingState`,
`EmptyState`, `ErrorState`, `ConfirmDialog`, `FormField`, `PageHeader`,
`ErrorBoundary`, `Table` primitives and the shadcn/ui controls.

## API endpoints consumed

All under `/api/v1`:

- Tournaments: `POST /tournaments`, `GET /tournaments/:id`,
  `PATCH /tournaments/:id`, `POST /tournaments/:id/transition`
- Categories: `GET /tournaments/:id/categories`,
  `POST /tournaments/:id/categories`, `GET /categories/:id`,
  `PATCH /categories/:id`, `POST /categories/:id/transition`
- Players: `POST /players`, `GET /players/:id`, `PATCH /players/:id`
- Teams: `POST /teams`, `GET /teams/:id`, `PATCH /teams/:id`,
  `GET /teams/:id/members`, `POST /teams/:id/members`,
  `DELETE /teams/:id/members/:playerId`
- Entries: `GET /categories/:id/entries`, `POST /categories/:id/entries`,
  `GET /entries/:id`, `PATCH /entries/:id`, `POST /entries/:id/confirm`,
  `POST /entries/:id/withdraw`, `POST /entries/:id/disqualify`
- Stages: `GET /categories/:id/stages`, `POST /categories/:id/stages`,
  `GET /stages/:id`, `PATCH /stages/:id`, `POST /stages/:id/transition`
- Matches: `GET /stages/:id/matches`, `POST /stages/:id/matches`,
  `GET /matches/:id`, `PATCH /matches/:id`, `POST /matches/:id/transition`,
  `GET /matches/:id/participants`, `POST /matches/:id/participants`

**No tournament, player or team collection endpoint exists in Phase 3.** The UI
therefore does not fabricate one. Instead it offers creation plus a "recent"
index that remembers the identifiers of records actually received from the API
(re-fetched by id when opened). This is a client-side index over real API data,
not a second data store, and no mock or hard-coded data is displayed. The
`Open by ID` cards let an operator jump to a known record.

## State strategy

No global state framework and no server-state library. Server state lives close
to the page that owns it via `useApiQuery` (loading/loaded/error + `refetch`) and
`useMutation` (idempotent submit, retained error, pending flag). After a
mutation the affected query is refetched — there is no full-page reload.
Cross-page "recent" items use a small React context.

Lifecycle options are derived from the shared `@badminton/domain` transition
tables (`lib/lifecycle.ts`), so the UI can only offer transitions the server
defines. The API still re-validates every transition; a rejection is displayed,
never assumed successful. Destructive transitions use a confirmation dialog.

## Forms

Forms validate for immediate feedback (required fields, date ordering, email and
phone shape, positive integers), but the API remains authoritative and its
field-level errors are merged over the local ones. Submit is disabled while a
request is pending, values are preserved on failure, and server errors are shown
safely.

## Testing

```bash
npm test                       # backend Vitest + web Vitest (via web workspace)
npm run test --workspace @badminton/web
npm run test:e2e               # Playwright (needs PostgreSQL + migrations)
```

- Frontend unit/component tests run in jsdom with Testing Library and mock the
  **API boundary** (`tests/helpers.tsx` builds a typed stub API). No database is
  required. They cover the API client error model, form validation, the
  `StatusBadge`, the tournament form, and page flows (create tournament, edit,
  create category, register singles/doubles entries, register-closed guard, team
  member add/remove, stage creation, participant assignment, entry withdrawal
  with confirmation).
- The E2E spec (`e2e/tournament-setup.spec.ts`) drives the real UI against the
  local API/PostgreSQL: create tournament → open registration → create category
  → create player → register entry.
- Existing backend suites are unchanged and remain the source of truth for
  API/database integration.

## Out of scope

No authentication/authorization, draw generation, brackets, group generation,
scoring, standings, ranking, scheduling, court allocation, live scoring,
realtime/WebSockets, notifications, payments, analytics, offline sync, PWA or
native app. No Prisma schema or migration changes. The UI consumes Phase 3; it
does not redefine API contracts.
