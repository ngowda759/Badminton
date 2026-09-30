import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/client.ts';
import { PlayerSelector } from '@/components/player-selector.tsx';
import { TeamSelector } from '@/components/team-selector.tsx';

import {
  createStubApi,
  makePlayerListItem,
  makeTeamListItem,
  renderWithProviders,
} from '../../tests/helpers.tsx';

/**
 * The shared competitor selectors are server-backed: they load the whole
 * collection (every page), render names rather than ids and surface loading,
 * empty and error states. Rendering them directly keeps these guarantees
 * independent of any single page.
 */
describe('PlayerSelector', () => {
  it('renders player names and reports the selected id, never the id', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.players.list.mockResolvedValue({
      items: [
        makePlayerListItem({ id: 'p1', name: 'Alice' }),
        makePlayerListItem({ id: 'p2', name: 'Bob' }),
      ],
      nextCursor: null,
    });
    const onValueChange = vi.fn();

    renderWithProviders(<PlayerSelector label="Player" value="" onValueChange={onValueChange} />, {
      api,
    });

    await user.click(await screen.findByLabelText('Player'));
    await user.click(await screen.findByRole('option', { name: 'Alice' }));

    expect(onValueChange).toHaveBeenCalledWith('p1');
    // The id is submitted, never shown as the trigger's text.
    expect(screen.queryByText('p1')).not.toBeInTheDocument();
  });

  it('walks every page so a player on a later page is selectable', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.players.list
      .mockResolvedValueOnce({
        items: [makePlayerListItem({ id: 'p1', name: 'Alice' })],
        nextCursor: 'p1',
      })
      .mockResolvedValueOnce({
        items: [makePlayerListItem({ id: 'p2', name: 'Bob' })],
        nextCursor: null,
      });

    renderWithProviders(<PlayerSelector label="Player" value="" onValueChange={vi.fn()} />, {
      api,
    });

    await user.click(await screen.findByLabelText('Player'));
    expect(await screen.findByRole('option', { name: 'Bob' })).toBeInTheDocument();
    // Two pages requested once each: no per-option (N+1) fetching.
    expect(api.players.list).toHaveBeenCalledTimes(2);
    expect(api.players.get).not.toHaveBeenCalled();
  });

  it('shows a loading placeholder and disables the trigger while loading', async () => {
    const api = createStubApi();
    api.players.list.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<PlayerSelector label="Player" value="" onValueChange={vi.fn()} />, {
      api,
    });

    const trigger = await screen.findByLabelText('Player');
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent('Loading…');
  });

  it('shows guidance when there are no players', async () => {
    const api = createStubApi();
    api.players.list.mockResolvedValue({ items: [], nextCursor: null });

    renderWithProviders(<PlayerSelector label="Player" value="" onValueChange={vi.fn()} />, {
      api,
    });

    expect(
      await screen.findByText('No players available. Create a player first.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Player')).toBeDisabled();
  });

  it('shows an error state and refetches on retry', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.players.list
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_SERVER_ERROR', 'Boom.'))
      .mockResolvedValue({
        items: [makePlayerListItem({ id: 'p1', name: 'Alice' })],
        nextCursor: null,
      });

    renderWithProviders(<PlayerSelector label="Player" value="" onValueChange={vi.fn()} />, {
      api,
    });

    expect(await screen.findByText('Could not load options')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Try again/ }));

    await waitFor(() => {
      expect(screen.getByLabelText('Player')).toBeEnabled();
    });
    expect(api.players.list).toHaveBeenCalledTimes(2);
  });
});

describe('TeamSelector', () => {
  it('renders team names and reports the selected id', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.teams.list.mockResolvedValue({
      items: [makeTeamListItem({ id: 'team-1', name: 'Smash Masters' })],
      nextCursor: null,
    });
    const onValueChange = vi.fn();

    renderWithProviders(<TeamSelector label="Team" value="" onValueChange={onValueChange} />, {
      api,
    });

    await user.click(await screen.findByLabelText('Team'));
    await user.click(await screen.findByRole('option', { name: 'Smash Masters' }));

    expect(onValueChange).toHaveBeenCalledWith('team-1');
  });

  it('shows guidance when there are no teams', async () => {
    const api = createStubApi();
    api.teams.list.mockResolvedValue({ items: [], nextCursor: null });

    renderWithProviders(<TeamSelector label="Team" value="" onValueChange={vi.fn()} />, { api });

    expect(await screen.findByText('No teams available. Create a team first.')).toBeInTheDocument();
  });
});
