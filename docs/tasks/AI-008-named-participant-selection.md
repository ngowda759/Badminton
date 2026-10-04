# AI-008 — Named participant selection on match detail (TASK-14, parity gap G14)

| Field          | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Task id        | `AI-008`                                                |
| Phase          | parity (G14 from the TASK-5 audit)                      |
| Status         | approved                                                |
| Human approval | not required — the brief is the implementation contract |
| Depends on     | AI-007                                                  |

## Summary

The TASK-5 parity audit records gap **G14** as a low-severity but genuine
operator-workflow divergence (audit §14, and the consolidated gap register):

> Match-detail assigns participants by raw entry UUID | n/a (no ids exposed) |
> `match-detail.tsx` participant inputs

V1 assigns a match's participants by **choosing them from a list** and never
exposes an internal id to the operator. V2's match detail instead asks the
operator to paste a raw entry UUID into each slot: `ParticipantSlots` renders two
`Input`s labelled *"Slot 1 entry ID"* / *"Slot 2 entry ID"* with the placeholder
*"Entry UUID"* (`apps/web/src/pages/tournaments/match-detail.tsx`). Typing a UUID
is error-prone and leaks the internal identity model into the UI.

This task replaces both slot inputs with a **server-backed dropdown over the
match's category entries**, labelled by competitor name. The operator picks an
entry instead of typing its UUID; the entry already occupying the other slot and
any non-eligible (withdrawn or disqualified) entry are not offered; and the
chosen id is still submitted through the existing
`POST /api/v1/matches/:matchId/participants` endpoint.

It is a **pure web change**. The server's eligibility rules — same category,
active entry, one entry per match, one occupant per slot — stay authoritative and
unchanged. The task reuses the existing per-category entries read
(`useEntryNames`) and the existing `Select` primitive, so it introduces no new
endpoint and no second data-fetching framework.

## Repository state after AI-007

- `MatchDetailPage` (`apps/web/src/pages/tournaments/match-detail.tsx`) renders
  `ParticipantSlots`, which today has two `<Input>` fields for raw entry UUIDs and
  an `Assign` button per slot. `assign(slot, entryId)` trims the typed value and
  calls `api.matches.addParticipant(match.id, { entryId, slot })`.
- `useEntryNames(categoryId)` already loads the category's entries once and
  resolves each entry id to a competitor name, falling back to a shortened id. It
  is the same source the group-fixture setup and regeneration use.
- The reusable `Select`/`SelectTrigger`/`SelectContent`/`SelectItem` primitive
  (`apps/web/src/components/ui/select.tsx`) and the higher-level
  `CollectionSelect` (`apps/web/src/components/collection-select.tsx`) already
  implement a labelled, id-valued, label-rendered dropdown with loading, empty and
  error handling. `GroupFixtureSetup` already filters to eligible entries with
  `entry.status === 'PENDING' || entry.status === 'CONFIRMED'`.
- The API is unchanged and already authoritative:
  `addParticipant` rejects a completed/cancelled match (422), an unknown entry or
  stage (404), a cross-category entry (422), an ineligible entry (422), an
  occupied slot (409) and a duplicate entry (409).

## Design

Replace the two raw-UUID inputs with a per-slot participant dropdown:

- Load the category's entries with `useEntryNames(category.id)`.
- Offer only **eligible** entries — `status` is `PENDING` or `CONFIRMED` — and
  exclude the entry already assigned to the **other** slot, so the operator is
  never offered a selection the server would reject with 409.
- Render each option's **competitor name** (never the UUID). Submitting still
  sends the entry **id** to `api.matches.addParticipant`.
- A slot that is already filled renders the assigned competitor's name and its
  control is disabled, matching today's "Slot filled" behaviour.
- The control is disabled while a request is pending and when the match is
  read-only (a knockout match), which stays bracket-controlled exactly as before.

The change is confined to the web application. No API route, DTO, service,
repository, domain type, realtime event or database object changes.

## Acceptance criteria

See the task queue entry for the full list. In short:

- `apps/web/src/components/tournaments/match-participant-select.test.tsx` (new)
  proves the dropdown offers one named option per eligible entry, hides the other
  slot's entry and any ineligible entry, calls the assignment handler with the
  selected id and slot, and is disabled when the slot is filled, a request is
  pending or the match is read-only.
- `apps/web/src/pages/tournaments/match-detail.test.tsx` (extended) proves a
  GROUP match renders named dropdowns (no raw-UUID inputs), that selecting an
  entry calls `api.matches.addParticipant` with `{ entryId, slot }` and refetches,
  that the slot-1 entry is not offered in slot 2, and that a withdrawn entry never
  appears.
- Each slot is reachable by an accessible label and the dropdown is
  keyboard-operable.
- `e2e/participant-selection.spec.ts` (new) proves the real UI/API/PostgreSQL
  flow: assign both slots by selecting competitors by name (no UUID typed
  anywhere) and transition the match to `IN_PROGRESS`.
- No backend change: nothing under `apps/api/**`, `packages/**` or
  `prisma/migrations/**`, and no change to `prisma/seed.ts` or
  `.github/workflows/ci.yml`. The existing participant integration cases still
  pass unedited.
- A KNOCKOUT match's slots stay read-only.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and
  `npm run test:e2e` pass.

## Out of scope

- Any API, application-service, repository, domain or database change; the
  server's participant eligibility and uniqueness rules stay authoritative.
- Assigning or editing participants on a KNOCKOUT match (bracket-controlled).
- Editing, replacing or clearing an existing participant slot.
- A new entry-listing or collection endpoint.
- The remaining TASK-5 gaps (G7/G8 scheduler, G10 team levels, G12 caps, G13
  qualification default, G16 group rename/membership editing) and the deferred
  backup import.
- Production data, credentials, or a hand merge.
