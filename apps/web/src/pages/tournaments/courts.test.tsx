import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '@/api/context.tsx';
import { TournamentProvider } from '@/components/tournaments/context.tsx';
import { CourtsManagePage } from '@/pages/tournaments/courts-manage.tsx';

import { createStubApi, makeCourt, makeMatch, makeTournament } from '../../../tests/helpers.tsx';

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const COURT_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COURT_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const TOURNAMENT = makeTournament({ id: TOURNAMENT_ID });

/**
 * Court-list removal (TASK-11, G11).
 *
 * The "Remove" control must be offered for a court with no matches, disabled
 * for a court that already has a match and for the tournament's only court, and
 * confirming it must call `DELETE /courts/:id` through the typed client and
 * refetch the list.
 */
function renderPage(api = createStubApi()) {
  render(
    <ApiProvider api={api}>
      <MemoryRouter>
        <TournamentProvider value={{ tournament: TOURNAMENT, refetch: vi.fn() }}>
          <CourtsManagePage />
        </TournamentProvider>
      </MemoryRouter>
    </ApiProvider>,
  );
  return api;
}

function twoCourts() {
  const api = createStubApi();
  vi.mocked(api.courts.listByTournament).mockResolvedValue([
    makeCourt({ id: COURT_ONE, tournamentId: TOURNAMENT_ID, number: 1, name: 'Court One' }),
    makeCourt({ id: COURT_TWO, tournamentId: TOURNAMENT_ID, number: 2, name: 'Court Two' }),
  ]);
  return api;
}

describe('CourtsManagePage removal', () => {
  it('removes a court with no matches on confirmation and refetches the list', async () => {
    const user = userEvent.setup();
    const api = twoCourts();
    renderPage(api);

    expect(await screen.findByText('Court One')).toBeInTheDocument();
    const row = screen.getByText('Court One').closest('tr');
    expect(row).not.toBeNull();
    const remove = within(row as HTMLElement).getByRole('button', { name: 'Remove' });
    expect(remove).toBeEnabled();

    await user.click(remove);

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(api.courts.remove).toHaveBeenCalledWith(COURT_ONE);
    });
    // The list is refetched after the removal.
    await waitFor(() => {
      expect(vi.mocked(api.courts.listByTournament).mock.calls.length).toBeGreaterThan(1);
    });
  });

  it('disables the Remove control for a court that already has a match', async () => {
    const api = twoCourts();
    vi.mocked(api.matches.listByStage).mockResolvedValue([makeMatch({ courtId: COURT_ONE })]);
    renderPage(api);

    expect(await screen.findByText('Court One')).toBeInTheDocument();
    const row = screen.getByText('Court One').closest('tr');
    expect(row).not.toBeNull();
    const remove = within(row as HTMLElement).getByRole('button', { name: 'Remove' });
    await waitFor(() => {
      expect(remove).toBeDisabled();
    });
  });

  it('disables the Remove control when it is the tournament’s only court', async () => {
    const api = createStubApi();
    vi.mocked(api.courts.listByTournament).mockResolvedValue([
      makeCourt({ id: COURT_ONE, tournamentId: TOURNAMENT_ID, number: 1, name: 'Court One' }),
    ]);
    renderPage(api);

    expect(await screen.findByText('Court One')).toBeInTheDocument();
    const row = screen.getByText('Court One').closest('tr');
    expect(row).not.toBeNull();
    const remove = within(row as HTMLElement).getByRole('button', { name: 'Remove' });
    expect(remove).toBeDisabled();
  });
});
