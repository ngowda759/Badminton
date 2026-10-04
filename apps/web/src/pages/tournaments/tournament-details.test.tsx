import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { ApiProvider } from '@/api/context.tsx';
import { TournamentProvider } from '@/components/tournaments/context.tsx';
import { TournamentDetailsPage } from '@/pages/tournaments/tournament-details.tsx';

import { createStubApi, makeTournament, makeTournamentBackup } from '../../../tests/helpers.tsx';

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const TOURNAMENT = makeTournament({ id: TOURNAMENT_ID });

/**
 * Tournament backup export and reset (TASK-13, G9).
 *
 * The "Export backup" control must call `GET /tournaments/:id/export` through
 * the typed client and download the returned JSON. The "Reset tournament"
 * control must open a confirmation dialog and, on confirm, call
 * `POST /tournaments/:id/reset` through the typed client and refetch the
 * tournament. A completed tournament cannot be reset.
 */

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let anchorClick: MockInstance<() => void>;

beforeEach(() => {
  createObjectURL = vi.fn(() => 'blob:backup');
  revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
  // jsdom cannot follow a download link; the click is observed, not performed.
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

function renderPage(api = createStubApi(), refetch = vi.fn()) {
  render(
    <ApiProvider api={api}>
      <MemoryRouter initialEntries={[`/tournaments/${TOURNAMENT_ID}`]}>
        <TournamentProvider value={{ tournament: TOURNAMENT, refetch }}>
          <TournamentDetailsPage />
        </TournamentProvider>
      </MemoryRouter>
    </ApiProvider>,
  );
  return { api, refetch };
}

describe('TournamentDetailsPage backup and reset', () => {
  it('exports the backup through the typed client and downloads JSON', async () => {
    const user = userEvent.setup();
    const { api } = renderPage();
    vi.mocked(api.tournaments.export).mockResolvedValue(makeTournamentBackup());

    await user.click(await screen.findByRole('button', { name: 'Export backup' }));

    await waitFor(() => {
      expect(api.tournaments.export).toHaveBeenCalledWith(TOURNAMENT_ID);
    });
    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(anchorClick).toHaveBeenCalledTimes(1);
    });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup');
  });

  it('resets the tournament after confirmation and refetches it', async () => {
    const user = userEvent.setup();
    const { api, refetch } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Reset tournament' }));

    const dialog = await screen.findByRole('dialog');
    // No request is sent until the destructive action is confirmed.
    expect(api.tournaments.reset).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Reset tournament' }));

    await waitFor(() => {
      expect(api.tournaments.reset).toHaveBeenCalledWith(TOURNAMENT_ID);
    });
    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
  });

  it('disables the reset control for a completed tournament', async () => {
    const api = createStubApi();
    render(
      <ApiProvider api={api}>
        <MemoryRouter initialEntries={[`/tournaments/${TOURNAMENT_ID}`]}>
          <TournamentProvider
            value={{
              tournament: makeTournament({ id: TOURNAMENT_ID, status: 'COMPLETED' }),
              refetch: vi.fn(),
            }}
          >
            <TournamentDetailsPage />
          </TournamentProvider>
        </MemoryRouter>
      </ApiProvider>,
    );

    const reset = await screen.findByRole('button', { name: 'Reset tournament' });
    expect(reset).toBeDisabled();
  });
});
