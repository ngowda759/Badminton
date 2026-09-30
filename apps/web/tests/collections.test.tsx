import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/client.ts';
import type { BadmintonApi } from '@/api/services.ts';
import { PlayersPage } from '@/pages/players/players.tsx';
import { TeamsPage } from '@/pages/teams/teams.tsx';
import { TournamentEntryPage } from '@/pages/tournaments/tournament-entry.tsx';

import {
  createStubApi,
  makePlayer,
  makePlayerListItem,
  makeTeamListItem,
  makeTournament,
  renderWithProviders,
} from './helpers.tsx';

/**
 * Server-backed collection lists.
 *
 * These mount the real pages, hooks and forms against a stubbed API boundary,
 * so they cover the four list states (loading, loaded, empty, error), the
 * create-then-refresh flow and detail navigation - the behaviours that replace
 * the old browser-session index.
 */

function listPage(ui: React.ReactNode, api: BadmintonApi, route: string) {
  return renderWithProviders(ui, { api, route });
}

describe('PlayersPage collection list', () => {
  it('shows a loading state while the list request is in flight', () => {
    const api = createStubApi();
    vi.mocked(api.players.list).mockReturnValue(new Promise(() => {}));

    listPage(<PlayersPage />, api, '/players');

    expect(screen.getByText('Loading players…')).toBeInTheDocument();
  });

  it('renders players returned by the server', async () => {
    const api = createStubApi();
    vi.mocked(api.players.list).mockResolvedValue({
      items: [
        makePlayerListItem({ id: 'p1', name: 'Alice' }),
        makePlayerListItem({ id: 'p2', name: 'Bob' }),
      ],
      nextCursor: null,
    });

    listPage(<PlayersPage />, api, '/players');

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    // The collection DTO omits contact details, so the list has no Contact column.
    expect(screen.queryByText('Contact')).not.toBeInTheDocument();
    expect(api.players.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20 }),
      expect.any(AbortSignal),
    );
  });

  it('shows an empty state when the server returns no players', async () => {
    const api = createStubApi();

    listPage(<PlayersPage />, api, '/players');

    expect(await screen.findByText('No players yet')).toBeInTheDocument();
  });

  it('shows an error state and refetches on retry', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    vi.mocked(api.players.list)
      .mockRejectedValueOnce(new ApiError(503, 'PERSISTENCE_ERROR', 'The service is unavailable.'))
      .mockResolvedValue({
        items: [makePlayerListItem({ id: 'p1', name: 'Alice' })],
        nextCursor: null,
      });

    listPage(<PlayersPage />, api, '/players');

    expect(await screen.findByTestId('error-state')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Alice')).toBeInTheDocument();
  });

  it('shows the newly created player after creation (server-backed refresh)', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    vi.mocked(api.players.list)
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValue({
        items: [makePlayerListItem({ id: 'p1', name: 'Newcomer' })],
        nextCursor: null,
      });
    vi.mocked(api.players.create).mockResolvedValue(makePlayer({ id: 'p1', name: 'Newcomer' }));

    listPage(<PlayersPage />, api, '/players');

    expect(await screen.findByText('No players yet')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Name/), 'Newcomer');
    await user.click(screen.getByRole('button', { name: 'Create player' }));

    expect(await screen.findByText('Newcomer')).toBeInTheDocument();
    expect(api.players.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Newcomer' }));
  });

  it('navigates to the player detail route when a row is opened', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    vi.mocked(api.players.list).mockResolvedValue({
      items: [makePlayerListItem({ id: 'p1', name: 'Alice' })],
      nextCursor: null,
    });

    listPage(
      <Routes>
        <Route path="/players" element={<PlayersPage />} />
        <Route path="/players/:playerId" element={<div>Player detail route</div>} />
      </Routes>,
      api,
      '/players',
    );

    await user.click(await screen.findByRole('link', { name: 'Alice' }));

    expect(await screen.findByText('Player detail route')).toBeInTheDocument();
  });
});

describe('TeamsPage collection list', () => {
  it('renders teams with their member count from the server', async () => {
    const api = createStubApi();
    vi.mocked(api.teams.list).mockResolvedValue({
      items: [makeTeamListItem({ id: 't1', name: 'Smash Masters', memberCount: 2 })],
      nextCursor: null,
    });

    listPage(<TeamsPage />, api, '/teams');

    expect(await screen.findByText('Smash Masters')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows an empty state when there are no teams', async () => {
    const api = createStubApi();

    listPage(<TeamsPage />, api, '/teams');

    expect(await screen.findByText('No teams yet')).toBeInTheDocument();
  });

  it('navigates to the team detail route when a row is opened', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    vi.mocked(api.teams.list).mockResolvedValue({
      items: [makeTeamListItem({ id: 't1', name: 'Smash Masters' })],
      nextCursor: null,
    });

    listPage(
      <Routes>
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/:teamId" element={<div>Team detail route</div>} />
      </Routes>,
      api,
      '/teams',
    );

    await user.click(await screen.findByRole('link', { name: 'Smash Masters' }));

    expect(await screen.findByText('Team detail route')).toBeInTheDocument();
  });
});

describe('TournamentEntryPage collection list', () => {
  it('renders tournaments with status and dates', async () => {
    const api = createStubApi();
    vi.mocked(api.tournaments.list).mockResolvedValue({
      items: [
        makeTournament({
          id: 't1',
          name: 'Autumn Open',
          status: 'REGISTRATION_OPEN',
          location: 'Bengaluru',
        }),
      ],
      nextCursor: null,
    });

    listPage(<TournamentEntryPage />, api, '/tournaments');

    expect(await screen.findByText('Autumn Open')).toBeInTheDocument();
    expect(screen.getByText('Registration open')).toBeInTheDocument();
    expect(screen.getByText('Bengaluru')).toBeInTheDocument();
  });

  it('shows an empty state with a create call to action', async () => {
    const api = createStubApi();

    listPage(<TournamentEntryPage />, api, '/tournaments');

    expect(await screen.findByText('No tournaments yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Create tournament' }).length).toBeGreaterThan(0);
  });

  it('loads the next page when load more is used', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    vi.mocked(api.tournaments.list)
      .mockResolvedValueOnce({
        items: [makeTournament({ id: 't1', name: 'First Cup' })],
        nextCursor: 't1',
      })
      .mockResolvedValue({
        items: [makeTournament({ id: 't2', name: 'Second Cup' })],
        nextCursor: null,
      });

    listPage(<TournamentEntryPage />, api, '/tournaments');

    expect(await screen.findByText('First Cup')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Second Cup')).toBeInTheDocument();
    expect(screen.getByText('First Cup')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.tournaments.list).toHaveBeenLastCalledWith(
        { limit: 20, cursor: 't1' },
        expect.any(AbortSignal),
      );
    });
  });
});
