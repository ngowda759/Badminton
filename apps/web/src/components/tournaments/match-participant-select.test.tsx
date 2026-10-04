import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MatchParticipantSelect } from '@/components/tournaments/match-participant-select.tsx';
import { useEntryNames } from '@/hooks/use-entry-names.ts';

import {
  createStubApi,
  makeEntry,
  makePlayer,
  renderWithProviders,
} from '../../../tests/helpers.tsx';

const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const ALICE_ENTRY = '66666666-6666-4666-8666-666666666666';
const BOB_ENTRY = '66666666-6666-4666-8666-666666666667';
const WITHDRAWN_ENTRY = '66666666-6666-4666-8666-666666666668';
const DISQUALIFIED_ENTRY = '66666666-6666-4666-8666-666666666669';
const ALICE_PLAYER = '33333333-3333-4333-8333-333333333333';
const BOB_PLAYER = '33333333-3333-4333-8333-333333333334';
const CAROL_PLAYER = '33333333-3333-4333-8333-333333333335';
const DAVE_PLAYER = '33333333-3333-4333-8333-333333333336';

/**
 * The participant select resolves competitor names from the category's entry
 * list (the same `useEntryNames` read the standings use) so this harness
 * exercises the real name-resolution path rather than a stubbed `nameFor`.
 */
function Harness(props: {
  readonly slot: 1 | 2;
  readonly assignedEntryId?: string | null;
  readonly excludedEntryIds?: readonly string[];
  readonly onAssign: (entryId: string, slot: 1 | 2) => void;
  readonly pending?: boolean;
  readonly readOnly?: boolean;
}) {
  const { entries, nameFor } = useEntryNames(CATEGORY_ID);
  return (
    <MatchParticipantSelect
      entries={entries}
      nameFor={nameFor}
      {...(props.assignedEntryId !== undefined ? { assignedEntryId: props.assignedEntryId } : {})}
      {...(props.excludedEntryIds ? { excludedEntryIds: props.excludedEntryIds } : {})}
      {...(props.pending ? { pending: props.pending } : {})}
      {...(props.readOnly ? { readOnly: props.readOnly } : {})}
      slot={props.slot}
      onAssign={props.onAssign}
    />
  );
}

/** A category with two eligible entries plus one withdrawn and one disqualified. */
function apiWithEntries() {
  const api = createStubApi();
  api.entries.listByCategory.mockResolvedValue([
    makeEntry({
      id: ALICE_ENTRY,
      categoryId: CATEGORY_ID,
      playerId: ALICE_PLAYER,
      status: 'CONFIRMED',
    }),
    makeEntry({ id: BOB_ENTRY, categoryId: CATEGORY_ID, playerId: BOB_PLAYER, status: 'PENDING' }),
    makeEntry({
      id: WITHDRAWN_ENTRY,
      categoryId: CATEGORY_ID,
      playerId: CAROL_PLAYER,
      status: 'WITHDRAWN',
    }),
    makeEntry({
      id: DISQUALIFIED_ENTRY,
      categoryId: CATEGORY_ID,
      playerId: DAVE_PLAYER,
      status: 'DISQUALIFIED',
    }),
  ]);
  const names: Record<string, string> = {
    [ALICE_PLAYER]: 'Alice',
    [BOB_PLAYER]: 'Bob',
    [CAROL_PLAYER]: 'Carol',
    [DAVE_PLAYER]: 'Dave',
  };
  api.players.get.mockImplementation((id) =>
    Promise.resolve(makePlayer({ id, name: names[id] ?? 'Unknown player' })),
  );
  return api;
}

describe('MatchParticipantSelect', () => {
  it('offers one option per eligible entry, labelled by name and never by id', async () => {
    const user = userEvent.setup();
    const api = apiWithEntries();

    renderWithProviders(<Harness slot={1} onAssign={vi.fn()} />, { api });

    await user.click(await screen.findByLabelText('Slot 1 participant'));

    expect(await screen.findByRole('option', { name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Bob' })).toBeInTheDocument();
    // Withdrawn and disqualified entries are not eligible.
    expect(screen.queryByRole('option', { name: 'Carol' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Dave' })).not.toBeInTheDocument();
    // The raw entry id is the option value, never its visible label.
    expect(screen.queryByRole('option', { name: ALICE_ENTRY })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: BOB_ENTRY })).not.toBeInTheDocument();
  });

  it('omits an entry already placed in the match', async () => {
    const user = userEvent.setup();
    const api = apiWithEntries();

    renderWithProviders(<Harness slot={2} excludedEntryIds={[ALICE_ENTRY]} onAssign={vi.fn()} />, {
      api,
    });

    await user.click(await screen.findByLabelText('Slot 2 participant'));

    expect(await screen.findByRole('option', { name: 'Bob' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Alice' })).not.toBeInTheDocument();
  });

  it('calls onAssign with the selected entry id and slot', async () => {
    const user = userEvent.setup();
    const api = apiWithEntries();
    const onAssign = vi.fn();

    renderWithProviders(<Harness slot={1} onAssign={onAssign} />, { api });

    await user.click(await screen.findByLabelText('Slot 1 participant'));
    await user.click(await screen.findByRole('option', { name: 'Bob' }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    expect(onAssign).toHaveBeenCalledWith(BOB_ENTRY, 1);
  });

  it('is disabled and shows the assigned competitor when the slot is filled', async () => {
    const api = apiWithEntries();

    renderWithProviders(<Harness slot={1} assignedEntryId={ALICE_ENTRY} onAssign={vi.fn()} />, {
      api,
    });

    const trigger = await screen.findByLabelText('Slot 1 participant');
    expect(trigger).toBeDisabled();
    await waitFor(() => {
      expect(trigger).toHaveTextContent('Alice');
    });
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
  });

  it('is disabled while a request is pending', async () => {
    const api = apiWithEntries();

    renderWithProviders(<Harness slot={1} pending onAssign={vi.fn()} />, { api });

    expect(await screen.findByLabelText('Slot 1 participant')).toBeDisabled();
  });

  it('exposes no assignment control when the match is read-only', async () => {
    const api = apiWithEntries();

    renderWithProviders(<Harness slot={1} readOnly onAssign={vi.fn()} />, { api });

    expect(await screen.findByLabelText('Slot 1 participant')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
  });
});
