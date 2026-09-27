import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { BadmintonApi } from '@/api/services.ts';
import { AppRoutes } from '@/routes.tsx';

import {
  createStubApi,
  makeCategory,
  makeEntry,
  makeMatch,
  makeParticipant,
  makePlayer,
  makeTeam,
  makeTeamMember,
  makeTournament,
  renderWithProviders,
} from './helpers.tsx';

/**
 * Page-level flows exercised against a stubbed API.
 *
 * These mount the real route tree, layouts, hooks and forms (only the API
 * boundary is mocked), so navigation, refetching and validation behaviour are
 * covered end to end within the browser.
 */
describe('tournament setup flows', () => {
  it('creates a tournament and lands on its details page', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const created = makeTournament({ id: 'new-tournament', name: 'Winter Cup' });
    api.tournaments.create.mockResolvedValueOnce(created);
    api.tournaments.get.mockResolvedValue(created);

    renderWithProviders(<AppRoutes />, { api, route: '/tournaments/new' });

    await user.type(await screen.findByLabelText(/^Name/), 'Winter Cup');
    await user.type(screen.getByLabelText(/^Start date/), '2026-10-01');
    await user.type(screen.getByLabelText(/^End date/), '2026-10-05');
    await user.click(screen.getByRole('button', { name: 'Create tournament' }));

    expect(await screen.findByRole('heading', { name: 'Winter Cup' })).toBeInTheDocument();
    expect(api.tournaments.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Winter Cup', startDate: '2026-10-01' }),
    );
  });

  it('offers only the documented next lifecycle states and applies one', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const tournament = makeTournament({ id: 't1', status: 'DRAFT' });
    api.tournaments.get.mockResolvedValue(tournament);

    renderWithProviders(<AppRoutes />, { api, route: '/tournaments/t1' });

    expect(await screen.findByRole('button', { name: 'Registration Open' })).toBeInTheDocument();
    // A DRAFT tournament cannot jump straight to IN_PROGRESS.
    expect(screen.queryByRole('button', { name: 'In Progress' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Registration Open' }));

    await waitFor(() => {
      expect(api.tournaments.transition).toHaveBeenCalledWith('t1', 'REGISTRATION_OPEN');
    });
  });

  it('creates a category inside a tournament', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const tournament = makeTournament({ id: 't1', status: 'REGISTRATION_OPEN' });
    const category = makeCategory({
      id: 'c1',
      name: 'Women Doubles',
      code: 'WD',
      format: 'DOUBLES',
    });
    api.tournaments.get.mockResolvedValue(tournament);
    api.categories.create.mockResolvedValue(category);
    api.categories.get.mockResolvedValue(category);
    api.categories.listByTournament.mockResolvedValue([]);

    renderWithProviders(<AppRoutes />, { api, route: '/tournaments/t1/categories/new' });

    await user.type(await screen.findByLabelText(/^Name/), 'Women Doubles');
    await user.type(screen.getByLabelText(/^Code/), 'wd');
    await user.click(screen.getByRole('button', { name: 'Create category' }));

    await waitFor(() => {
      expect(api.categories.create).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ name: 'Women Doubles', code: 'WD', format: 'SINGLES' }),
      );
    });
    expect(await screen.findByRole('heading', { name: 'Women Doubles' })).toBeInTheDocument();
  });

  it('registers a singles entry with the player id and no team id', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const tournament = makeTournament({ id: 't1', status: 'REGISTRATION_OPEN' });
    const category = makeCategory({ id: 'c1', format: 'SINGLES', status: 'OPEN' });
    api.tournaments.get.mockResolvedValue(tournament);
    api.categories.get.mockResolvedValue(category);
    api.entries.listByCategory.mockResolvedValue([]);
    api.entries.register.mockResolvedValue(makeEntry());

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/entries',
    });

    await user.type(await screen.findByLabelText(/^Player ID/), 'p1');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => {
      expect(api.entries.register).toHaveBeenCalledWith('c1', { playerId: 'p1' });
    });
  });

  it('registers a doubles entry with the team id and no player id', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const tournament = makeTournament({ id: 't1', status: 'REGISTRATION_OPEN' });
    const category = makeCategory({ id: 'c1', format: 'DOUBLES', status: 'OPEN' });
    api.tournaments.get.mockResolvedValue(tournament);
    api.categories.get.mockResolvedValue(category);
    api.entries.listByCategory.mockResolvedValue([]);

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/entries',
    });

    await user.type(await screen.findByLabelText(/^Team ID/), 'team-1');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => {
      expect(api.entries.register).toHaveBeenCalledWith('c1', { teamId: 'team-1' });
    });
  });

  it('shows a registration-closed warning and disables the register control', async () => {
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(
      makeTournament({ id: 't1', status: 'REGISTRATION_CLOSED' }),
    );
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'CLOSED' }));
    api.entries.listByCategory.mockResolvedValue([]);

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/entries',
    });

    expect(await screen.findByText(/Registration is closed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register' })).toBeDisabled();
  });

  it('manages team members add and remove', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const team = makeTeam({ id: 'team-1', name: 'Smash Masters' });
    const member = makeTeamMember({ teamId: 'team-1', playerId: 'p1' });
    api.teams.get.mockResolvedValue(team);
    api.teams.listMembers.mockResolvedValue([member]);
    api.players.get.mockResolvedValue(makePlayer({ id: 'p1', name: 'Player A' }));

    renderWithProviders(<AppRoutes />, { api, route: '/teams/team-1' });

    expect(await screen.findByText('Player A')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(api.teams.removeMember).toHaveBeenCalledWith('team-1', 'p1');
    });
  });

  it('creates a stage with its sequence', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.stages.listByCategory.mockResolvedValue([]);

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/stages',
    });

    await user.type(await screen.findByLabelText(/^Name/), 'Group A');
    await user.click(screen.getByRole('button', { name: 'Create stage' }));

    await waitFor(() => {
      expect(api.stages.create).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ name: 'Group A', sequence: 1, type: 'GROUP' }),
      );
    });
  });

  it('assigns a match participant to slot 1', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const match = makeMatch({ id: 'm1', stageId: 's1' });
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.matches.get.mockResolvedValue(match);
    api.matches.listParticipants.mockResolvedValue([]);
    api.matches.addParticipant.mockResolvedValue(makeParticipant());
    api.entries.listByCategory.mockResolvedValue([]);

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/matches/m1',
    });

    await user.type(await screen.findByLabelText(/^Slot 1 entry ID/), 'e1');
    await user.click(screen.getAllByRole('button', { name: 'Assign' })[0] as HTMLElement);

    await waitFor(() => {
      expect(api.matches.addParticipant).toHaveBeenCalledWith('m1', { entryId: 'e1', slot: 1 });
    });
  });

  it('withdraws an entry only after confirmation', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const entry = makeEntry({ id: 'e1', playerId: 'p1', status: 'CONFIRMED' });
    api.tournaments.get.mockResolvedValue(
      makeTournament({ id: 't1', status: 'REGISTRATION_OPEN' }),
    );
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.entries.listByCategory.mockResolvedValue([entry]);
    api.players.get.mockResolvedValue(makePlayer({ id: 'p1', name: 'Player A' }));

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/entries',
    });

    await user.click(await screen.findByRole('button', { name: 'Withdrawn' }));
    expect(api.entries.withdraw).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Withdrawn' }));

    await waitFor(() => {
      expect(api.entries.withdraw).toHaveBeenCalledWith('e1');
    });
  });
});

/** Keeps the stub type referenced for readers of this file. */
export type { BadmintonApi };
