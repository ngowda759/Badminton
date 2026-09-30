import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { BadmintonApi } from '@/api/services.ts';
import { AppRoutes } from '@/routes.tsx';

import { ApiError } from '@/api/client.ts';

import {
  createStubApi,
  makeBracket,
  makeBracketMatch,
  makeCategory,
  makeEntry,
  makeGroupFixtures,
  makeMatch,
  makeMatchResult,
  makeParticipant,
  makePlayer,
  makePlayerListItem,
  makeStage,
  makeStandingRow,
  makeTeam,
  makeTeamListItem,
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

  it('registers a singles entry with the selected player id and no team id', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const tournament = makeTournament({ id: 't1', status: 'REGISTRATION_OPEN' });
    const category = makeCategory({ id: 'c1', format: 'SINGLES', status: 'OPEN' });
    api.tournaments.get.mockResolvedValue(tournament);
    api.categories.get.mockResolvedValue(category);
    api.entries.listByCategory.mockResolvedValue([]);
    api.entries.register.mockResolvedValue(makeEntry());
    api.players.list.mockResolvedValue({
      items: [
        makePlayerListItem({ id: 'p1', name: 'Alice' }),
        makePlayerListItem({ id: 'p2', name: 'Bob' }),
      ],
      nextCursor: null,
    });

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/entries',
    });

    await user.click(await screen.findByLabelText('Player'));
    await user.click(await screen.findByRole('option', { name: 'Alice' }));
    await user.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => {
      expect(api.entries.register).toHaveBeenCalledWith('c1', { playerId: 'p1' });
    });
  });

  it('registers a doubles entry with the selected team id and no player id', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const tournament = makeTournament({ id: 't1', status: 'REGISTRATION_OPEN' });
    const category = makeCategory({ id: 'c1', format: 'DOUBLES', status: 'OPEN' });
    api.tournaments.get.mockResolvedValue(tournament);
    api.categories.get.mockResolvedValue(category);
    api.entries.listByCategory.mockResolvedValue([]);
    api.entries.register.mockResolvedValue(makeEntry());
    api.teams.list.mockResolvedValue({
      items: [
        makeTeamListItem({ id: 'team-1', name: 'Smash Masters' }),
        makeTeamListItem({ id: 'team-2', name: 'Net Ninjas' }),
      ],
      nextCursor: null,
    });

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/entries',
    });

    await user.click(await screen.findByLabelText('Team'));
    await user.click(await screen.findByRole('option', { name: 'Smash Masters' }));
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

  it('keeps Register disabled until a player is selected', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(
      makeTournament({ id: 't1', status: 'REGISTRATION_OPEN' }),
    );
    api.categories.get.mockResolvedValue(
      makeCategory({ id: 'c1', format: 'SINGLES', status: 'OPEN' }),
    );
    api.entries.listByCategory.mockResolvedValue([]);
    api.players.list.mockResolvedValue({
      items: [makePlayerListItem({ id: 'p1', name: 'Alice' })],
      nextCursor: null,
    });

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/entries',
    });

    const register = await screen.findByRole('button', { name: 'Register' });
    await waitFor(() => {
      expect(screen.getByLabelText('Player')).toBeEnabled();
    });
    expect(register).toBeDisabled();

    await user.click(screen.getByLabelText('Player'));
    await user.click(await screen.findByRole('option', { name: 'Alice' }));
    expect(register).toBeEnabled();
  });

  it('shows a loading state while the player options load', async () => {
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(
      makeTournament({ id: 't1', status: 'REGISTRATION_OPEN' }),
    );
    api.categories.get.mockResolvedValue(
      makeCategory({ id: 'c1', format: 'SINGLES', status: 'OPEN' }),
    );
    api.entries.listByCategory.mockResolvedValue([]);
    api.players.list.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/entries',
    });

    const trigger = await screen.findByLabelText('Player');
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent('Loading…');
    expect(screen.getByRole('button', { name: 'Register' })).toBeDisabled();
  });

  it('shows an empty state when there are no players', async () => {
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(
      makeTournament({ id: 't1', status: 'REGISTRATION_OPEN' }),
    );
    api.categories.get.mockResolvedValue(
      makeCategory({ id: 'c1', format: 'SINGLES', status: 'OPEN' }),
    );
    api.entries.listByCategory.mockResolvedValue([]);
    api.players.list.mockResolvedValue({ items: [], nextCursor: null });

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/entries',
    });

    expect(
      await screen.findByText('No players available. Create a player first.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register' })).toBeDisabled();
  });

  it('shows an error state and retries loading the player options', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(
      makeTournament({ id: 't1', status: 'REGISTRATION_OPEN' }),
    );
    api.categories.get.mockResolvedValue(
      makeCategory({ id: 'c1', format: 'SINGLES', status: 'OPEN' }),
    );
    api.entries.listByCategory.mockResolvedValue([]);
    api.players.list
      .mockRejectedValueOnce(
        new ApiError(500, 'INTERNAL_SERVER_ERROR', 'The server encountered an error.'),
      )
      .mockResolvedValue({
        items: [makePlayerListItem({ id: 'p1', name: 'Alice' })],
        nextCursor: null,
      });

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/entries',
    });

    expect(await screen.findByText('Could not load options')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Try again/ }));

    await user.click(await screen.findByLabelText('Player'));
    expect(await screen.findByRole('option', { name: 'Alice' })).toBeInTheDocument();
  });

  it('loads every page of players so a later page is selectable', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(
      makeTournament({ id: 't1', status: 'REGISTRATION_OPEN' }),
    );
    api.categories.get.mockResolvedValue(
      makeCategory({ id: 'c1', format: 'SINGLES', status: 'OPEN' }),
    );
    api.entries.listByCategory.mockResolvedValue([]);
    api.players.list
      .mockResolvedValueOnce({
        items: [makePlayerListItem({ id: 'p1', name: 'Alice' })],
        nextCursor: 'p1',
      })
      .mockResolvedValueOnce({
        items: [makePlayerListItem({ id: 'p2', name: 'Bob' })],
        nextCursor: null,
      });

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/entries',
    });

    await user.click(await screen.findByLabelText('Player'));
    // "Bob" only exists on the second page: proving the walk, not just page one.
    expect(await screen.findByRole('option', { name: 'Bob' })).toBeInTheDocument();
    expect(api.players.list).toHaveBeenCalledTimes(2);
  });

  it('disables the competitor selector when registration is closed', async () => {
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(
      makeTournament({ id: 't1', status: 'REGISTRATION_CLOSED' }),
    );
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'CLOSED' }));
    api.entries.listByCategory.mockResolvedValue([]);
    api.players.list.mockResolvedValue({
      items: [makePlayerListItem({ id: 'p1', name: 'Alice' })],
      nextCursor: null,
    });

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/entries',
    });

    expect(await screen.findByText(/Registration is closed/)).toBeInTheDocument();
    expect(screen.getByLabelText('Player')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Register' })).toBeDisabled();
  });

  it('manages team members add and remove', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const team = makeTeam({ id: 'team-1', name: 'Smash Masters' });
    const member = makeTeamMember({ teamId: 'team-1', playerId: 'p1' });
    api.teams.get.mockResolvedValue(team);
    api.teams.listMembers.mockResolvedValue([member]);
    api.teams.addMember.mockResolvedValue(makeTeamMember());
    api.players.get.mockResolvedValue(makePlayer({ id: 'p1', name: 'Player A' }));
    api.players.list.mockResolvedValue({
      items: [makePlayerListItem({ id: 'p2', name: 'Player B' })],
      nextCursor: null,
    });

    renderWithProviders(<AppRoutes />, { api, route: '/teams/team-1' });

    expect(await screen.findByText('Player A')).toBeInTheDocument();

    // Adding a member selects a player instead of typing a UUID.
    await user.click(await screen.findByLabelText('Player'));
    await user.click(await screen.findByRole('option', { name: 'Player B' }));
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    await waitFor(() => {
      expect(api.teams.addMember).toHaveBeenCalledWith('team-1', { playerId: 'p2' });
    });

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

  it('records a 2-0 result from an in-progress match and completes it', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const match = makeMatch({ id: 'm1', stageId: 's1', status: 'IN_PROGRESS' });
    const entryA = makeEntry({ id: 'e1', playerId: 'p1' });
    const entryB = makeEntry({ id: 'e2', playerId: 'p2' });
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.matches.get.mockResolvedValue(match);
    api.matches.listParticipants.mockResolvedValue([
      makeParticipant({ matchId: 'm1', entryId: 'e1', slot: 1 }),
      makeParticipant({ id: 'p-e2', matchId: 'm1', entryId: 'e2', slot: 2 }),
    ]);
    api.matches.getResult.mockResolvedValue(null);
    api.matches.recordResult.mockResolvedValue(makeMatchResult());
    api.entries.listByCategory.mockResolvedValue([entryA, entryB]);
    api.players.get.mockImplementation((id: string) =>
      Promise.resolve(makePlayer({ id, name: id === 'p1' ? 'Alice' : 'Bob' })),
    );

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/matches/m1',
    });

    await user.type(await screen.findByLabelText('Game 1 — Alice points'), '21');
    await user.type(screen.getByLabelText('Game 1 — Bob points'), '15');
    await user.type(screen.getByLabelText('Game 2 — Alice points'), '21');
    await user.type(screen.getByLabelText('Game 2 — Bob points'), '18');

    expect(await screen.findByTestId('match-winner')).toHaveTextContent('Match winner: Alice');

    await user.click(screen.getByRole('button', { name: 'Save & complete result' }));

    await waitFor(() => {
      expect(api.matches.recordResult).toHaveBeenCalledWith('m1', {
        games: [
          { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
          { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
        ],
      });
    });
  });

  it('shows a completed match result read-only', async () => {
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.matches.get.mockResolvedValue(
      makeMatch({ id: 'm1', stageId: 's1', status: 'COMPLETED', winnerEntryId: 'e1' }),
    );
    api.matches.listParticipants.mockResolvedValue([
      makeParticipant({ matchId: 'm1', entryId: 'e1', slot: 1 }),
      makeParticipant({ id: 'p-e2', matchId: 'm1', entryId: 'e2', slot: 2 }),
    ]);
    api.matches.getResult.mockResolvedValue(makeMatchResult());
    api.entries.listByCategory.mockResolvedValue([
      makeEntry({ id: 'e1', playerId: 'p1' }),
      makeEntry({ id: 'e2', playerId: 'p2' }),
    ]);
    api.players.get.mockImplementation((id: string) =>
      Promise.resolve(makePlayer({ id, name: id === 'p1' ? 'Alice' : 'Bob' })),
    );

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/matches/m1',
    });

    // Entry names resolve asynchronously after the result renders, so wait for
    // the resolved label rather than the first paint.
    await waitFor(() => {
      expect(screen.getByTestId('match-result-winner')).toHaveTextContent('Winner: Alice (2–0)');
    });
    expect(screen.getByTestId('result-game-1')).toHaveTextContent('Game 1: Alice 21 – 15 Bob');
    // A completed result is immutable: no scoring form or save button.
    expect(
      screen.queryByRole('button', { name: 'Save & complete result' }),
    ).not.toBeInTheDocument();
  });

  it('surfaces a scoring API error safely', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.matches.get.mockResolvedValue(
      makeMatch({ id: 'm1', stageId: 's1', status: 'IN_PROGRESS' }),
    );
    api.matches.listParticipants.mockResolvedValue([
      makeParticipant({ matchId: 'm1', entryId: 'e1', slot: 1 }),
      makeParticipant({ id: 'p-e2', matchId: 'm1', entryId: 'e2', slot: 2 }),
    ]);
    api.matches.getResult.mockResolvedValue(null);
    api.matches.recordResult.mockRejectedValueOnce(
      new ApiError(422, 'BUSINESS_RULE_VIOLATION', 'Match is already completed.'),
    );
    api.entries.listByCategory.mockResolvedValue([
      makeEntry({ id: 'e1', playerId: 'p1' }),
      makeEntry({ id: 'e2', playerId: 'p2' }),
    ]);
    api.players.get.mockImplementation((id: string) =>
      Promise.resolve(makePlayer({ id, name: id === 'p1' ? 'Alice' : 'Bob' })),
    );

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/matches/m1',
    });

    await user.type(await screen.findByLabelText('Game 1 — Alice points'), '21');
    await user.type(screen.getByLabelText('Game 1 — Bob points'), '15');
    await user.type(screen.getByLabelText('Game 2 — Alice points'), '21');
    await user.type(screen.getByLabelText('Game 2 — Bob points'), '18');
    await user.click(screen.getByRole('button', { name: 'Save & complete result' }));

    expect(await screen.findByText('Match is already completed.')).toBeInTheDocument();
  });

  it('renders group standings derived from completed matches', async () => {
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.stages.get.mockResolvedValue(makeStage({ id: 's1', type: 'GROUP' }));
    api.matches.listByStage.mockResolvedValue([]);
    api.stages.standings.mockResolvedValue([
      makeStandingRow({ entryId: 'e1', position: 1, won: 1, lost: 0, gameDifference: 2 }),
      makeStandingRow({ entryId: 'e2', position: 2, won: 0, lost: 1, gameDifference: -2 }),
    ]);
    api.entries.listByCategory.mockResolvedValue([
      makeEntry({ id: 'e1', playerId: 'p1' }),
      makeEntry({ id: 'e2', playerId: 'p2' }),
    ]);
    api.players.get.mockImplementation((id: string) =>
      Promise.resolve(makePlayer({ id, name: id === 'p1' ? 'Alice' : 'Bob' })),
    );

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/stages/s1',
    });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Alice')).toBeInTheDocument();
    expect(within(table).getByText('Bob')).toBeInTheDocument();
    expect(within(table).getByText('Competitor')).toBeInTheDocument();
  });

  it('shows an empty standings state when no matches are complete', async () => {
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.stages.get.mockResolvedValue(makeStage({ id: 's1', type: 'GROUP' }));
    api.matches.listByStage.mockResolvedValue([]);
    api.stages.standings.mockResolvedValue([]);
    api.entries.listByCategory.mockResolvedValue([]);

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/stages/s1',
    });

    expect(await screen.findByText('No standings yet')).toBeInTheDocument();
  });

  it('shows a standings error state when the endpoint fails', async () => {
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.stages.get.mockResolvedValue(makeStage({ id: 's1', type: 'GROUP' }));
    api.matches.listByStage.mockResolvedValue([]);
    api.stages.standings.mockRejectedValueOnce(
      new ApiError(
        500,
        'INTERNAL_SERVER_ERROR',
        'The server encountered an error. Please try again.',
      ),
    );
    api.entries.listByCategory.mockResolvedValue([]);

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/stages/s1',
    });

    expect(await screen.findByText('Could not load standings')).toBeInTheDocument();
  });
});

/**
 * Knockout bracket UI.
 *
 * A KNOCKOUT stage shows bracket setup instead of standings: the operator picks
 * and orders active entries, confirms, and the generated bracket renders as
 * round columns with TBD slots and winners. The API boundary is stubbed; the
 * components, hooks and validation run for real.
 */
describe('knockout bracket flows', () => {
  it('generates a bracket from ordered entries after confirmation', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.stages.get.mockResolvedValue(makeStage({ id: 's1', type: 'KNOCKOUT', name: 'Knockout' }));
    api.matches.listByStage.mockResolvedValue([]);
    api.entries.listByCategory.mockResolvedValue([
      makeEntry({ id: 'e1', playerId: 'p1', status: 'CONFIRMED' }),
      makeEntry({ id: 'e2', playerId: 'p2', status: 'CONFIRMED' }),
    ]);
    api.players.get.mockImplementation((id: string) =>
      Promise.resolve(makePlayer({ id, name: id === 'p1' ? 'Alice' : 'Bob' })),
    );
    // First read is empty (setup); after generation it returns the bracket.
    api.stages.getBracket
      .mockResolvedValueOnce(makeBracket({ rounds: [] }))
      .mockResolvedValue(makeBracket());
    api.stages.generateBracket.mockResolvedValue(makeBracket());

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/stages/s1',
    });

    // No standings table for a knockout stage.
    expect(await screen.findByText('No bracket yet')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Standings' })).not.toBeInTheDocument();

    await screen.findByText('Alice');
    await user.click(screen.getByRole('checkbox', { name: /Alice/ }));
    await user.click(screen.getByRole('checkbox', { name: /Bob/ }));
    expect(screen.getByTestId('bracket-shape')).toHaveTextContent('Final (1)');

    await user.click(screen.getByRole('button', { name: 'Generate bracket' }));
    // Confirmation is required before the mutation runs.
    expect(api.stages.generateBracket).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Generate bracket' }));

    await waitFor(() => {
      expect(api.stages.generateBracket).toHaveBeenCalledWith('s1', { entryIds: ['e1', 'e2'] });
    });
  });

  it('renders the bracket with participants, TBD slots and the winner', async () => {
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.stages.get.mockResolvedValue(makeStage({ id: 's1', type: 'KNOCKOUT', name: 'Knockout' }));
    api.matches.listByStage.mockResolvedValue([]);
    api.entries.listByCategory.mockResolvedValue([
      makeEntry({ id: 'e1', playerId: 'p1', status: 'CONFIRMED' }),
      makeEntry({ id: 'e2', playerId: 'p2', status: 'CONFIRMED' }),
      makeEntry({ id: 'e3', playerId: 'p3', status: 'CONFIRMED' }),
      makeEntry({ id: 'e4', playerId: 'p4', status: 'CONFIRMED' }),
    ]);
    api.players.get.mockImplementation((id: string) =>
      Promise.resolve(
        makePlayer({
          id,
          name: { p1: 'Alice', p2: 'Bob', p3: 'Cara', p4: 'Dana' }[id] ?? id,
        }),
      ),
    );
    api.stages.getBracket.mockResolvedValue(
      makeBracket({
        bracketSize: 4,
        roundCount: 2,
        rounds: [
          {
            roundNumber: 1,
            name: 'Semifinals',
            matches: [
              makeBracketMatch({
                matchId: 'm1',
                matchNumber: 1,
                status: 'COMPLETED',
                winnerEntryId: 'e1',
                participant1: { slot: 1, entryId: 'e1' },
                participant2: { slot: 2, entryId: 'e2' },
              }),
              makeBracketMatch({
                matchId: 'm2',
                matchNumber: 2,
                participant1: { slot: 1, entryId: 'e3' },
                participant2: { slot: 2, entryId: 'e4' },
              }),
            ],
          },
          {
            roundNumber: 2,
            name: 'Final',
            matches: [
              makeBracketMatch({
                matchId: 'm3',
                matchNumber: 1,
                participant1: { slot: 1, entryId: 'e1' },
                participant2: { slot: 2, entryId: null },
              }),
            ],
          },
        ],
      }),
    );

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/stages/s1',
    });

    expect(await screen.findByText(/4-entry bracket/)).toBeInTheDocument();
    expect(screen.getByText('Semifinals')).toBeInTheDocument();
    expect(screen.getByText('Final')).toBeInTheDocument();
    // Alice reached the final, so her name appears in both rounds.
    expect(await screen.findAllByText('Alice')).not.toHaveLength(0);
    expect(screen.getByText('Cara')).toBeInTheDocument();
    // The unresolved final slot is shown as TBD.
    expect(screen.getByText('TBD')).toBeInTheDocument();
    // The completed semifinal marks its winner.
    expect(screen.getByText('Winner')).toBeInTheDocument();
    // Setup is gone once a bracket exists.
    expect(screen.queryByRole('button', { name: 'Generate bracket' })).not.toBeInTheDocument();
  });

  it('locks the bracket size once a knockout bracket has been generated', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.stages.get.mockResolvedValue(
      makeStage({ id: 's1', type: 'KNOCKOUT', name: 'Knockout', drawSize: 2 }),
    );
    api.matches.listByStage.mockResolvedValue([
      makeMatch({ id: 'm1', stageId: 's1', roundNumber: 1, matchNumber: 1 }),
    ]);
    api.entries.listByCategory.mockResolvedValue([]);
    api.stages.getBracket.mockResolvedValue(makeBracket({ bracketSize: 2 }));

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/stages/s1',
    });

    expect(
      await screen.findByText('The bracket size is fixed once the bracket has been generated.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Draw size')).toBeDisabled();

    // Saving name/sequence must not send a drawSize that the API would reject.
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(api.stages.update).toHaveBeenCalledWith('s1', { name: 'Knockout', sequence: 1 });
    });
  });
});

/**
 * Group-stage fixture flows.
 *
 * A GROUP stage with no matches shows the fixture setup: the operator selects
 * and orders active entries, confirms, and the generated round-robin appears as
 * matches. The API boundary is stubbed; the components, hooks and validation run
 * for real.
 */
describe('group fixture flows', () => {
  it('generates a round-robin from selected entries after confirmation', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.stages.get.mockResolvedValue(makeStage({ id: 's1', type: 'GROUP', name: 'Group A' }));
    api.matches.listByStage.mockResolvedValue([]);
    api.stages.standings.mockResolvedValue([]);
    api.entries.listByCategory.mockResolvedValue([
      makeEntry({ id: 'e1', playerId: 'p1', status: 'CONFIRMED' }),
      makeEntry({ id: 'e2', playerId: 'p2', status: 'CONFIRMED' }),
      makeEntry({ id: 'e3', playerId: 'p3', status: 'CONFIRMED' }),
    ]);
    api.players.get.mockImplementation((id: string) =>
      Promise.resolve(makePlayer({ id, name: { p1: 'Alice', p2: 'Bob', p3: 'Cara' }[id] ?? id })),
    );
    api.stages.generateFixtures.mockResolvedValue(makeGroupFixtures({ competitorCount: 3 }));

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/stages/s1',
    });

    await screen.findByText('Alice');
    await user.click(screen.getByRole('checkbox', { name: /Alice/ }));
    await user.click(screen.getByRole('checkbox', { name: /Bob/ }));
    await user.click(screen.getByRole('checkbox', { name: /Cara/ }));
    expect(screen.getByTestId('group-fixture-shape')).toHaveTextContent('3 selected');
    expect(screen.getByTestId('group-fixture-shape')).toHaveTextContent('3 matches');

    await user.click(screen.getByRole('button', { name: 'Generate fixtures' }));
    // Confirmation is required before the mutation runs.
    expect(api.stages.generateFixtures).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Generate fixtures' }));

    await waitFor(() => {
      expect(api.stages.generateFixtures).toHaveBeenCalledWith('s1', {
        entryIds: ['e1', 'e2', 'e3'],
      });
    });
  });

  it('keeps the caller ordering as entries are moved', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.stages.get.mockResolvedValue(makeStage({ id: 's1', type: 'GROUP', name: 'Group A' }));
    api.matches.listByStage.mockResolvedValue([]);
    api.stages.standings.mockResolvedValue([]);
    api.entries.listByCategory.mockResolvedValue([
      makeEntry({ id: 'e1', playerId: 'p1', status: 'CONFIRMED' }),
      makeEntry({ id: 'e2', playerId: 'p2', status: 'CONFIRMED' }),
    ]);
    api.players.get.mockImplementation((id: string) =>
      Promise.resolve(makePlayer({ id, name: id === 'p1' ? 'Alice' : 'Bob' })),
    );
    api.stages.generateFixtures.mockResolvedValue(makeGroupFixtures());

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/stages/s1',
    });

    await screen.findByText('Alice');
    await user.click(screen.getByRole('checkbox', { name: /Alice/ }));
    await user.click(screen.getByRole('checkbox', { name: /Bob/ }));

    // Move Bob (currently #2) above Alice (#1).
    await user.click(screen.getAllByRole('button', { name: 'Up' })[1] as HTMLElement);

    await user.click(screen.getByRole('button', { name: 'Generate fixtures' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Generate fixtures' }));

    await waitFor(() => {
      expect(api.stages.generateFixtures).toHaveBeenCalledWith('s1', {
        entryIds: ['e2', 'e1'],
      });
    });
  });

  it('renders the persisted fixtures as matches on load and after refresh', async () => {
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.stages.get.mockResolvedValue(makeStage({ id: 's1', type: 'GROUP', name: 'Group A' }));
    // The initial REST load already returns the generated fixtures, exactly as
    // it would after a page refresh.
    api.matches.listByStage.mockResolvedValue([
      makeMatch({ id: 'm1', stageId: 's1', sequence: 1, roundNumber: 1, matchNumber: 1 }),
      makeMatch({ id: 'm2', stageId: 's1', sequence: 2, roundNumber: 2, matchNumber: 2 }),
    ]);
    api.matches.listParticipants.mockResolvedValue([]);
    api.stages.standings.mockResolvedValue([]);
    api.entries.listByCategory.mockResolvedValue([
      makeEntry({ id: 'e1', playerId: 'p1', status: 'CONFIRMED' }),
      makeEntry({ id: 'e2', playerId: 'p2', status: 'CONFIRMED' }),
    ]);
    api.players.get.mockImplementation((id: string) =>
      Promise.resolve(makePlayer({ id, name: id === 'p1' ? 'Alice' : 'Bob' })),
    );

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/stages/s1',
    });

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    // Once fixtures exist the setup disappears; the match list is authoritative.
    expect(screen.queryByRole('button', { name: 'Generate fixtures' })).not.toBeInTheDocument();
    expect(api.matches.listByStage).toHaveBeenCalledWith('s1', expect.anything());
  });

  it('shows an error state when fixture generation fails', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.tournaments.get.mockResolvedValue(makeTournament({ id: 't1', status: 'IN_PROGRESS' }));
    api.categories.get.mockResolvedValue(makeCategory({ id: 'c1', status: 'OPEN' }));
    api.stages.get.mockResolvedValue(makeStage({ id: 's1', type: 'GROUP', name: 'Group A' }));
    api.matches.listByStage.mockResolvedValue([]);
    api.stages.standings.mockResolvedValue([]);
    api.entries.listByCategory.mockResolvedValue([
      makeEntry({ id: 'e1', playerId: 'p1', status: 'CONFIRMED' }),
      makeEntry({ id: 'e2', playerId: 'p2', status: 'CONFIRMED' }),
    ]);
    api.players.get.mockImplementation((id: string) =>
      Promise.resolve(makePlayer({ id, name: id === 'p1' ? 'Alice' : 'Bob' })),
    );
    api.stages.generateFixtures.mockRejectedValueOnce(
      new ApiError(409, 'CONFLICT', 'This stage already has fixtures.'),
    );

    renderWithProviders(<AppRoutes />, {
      api,
      route: '/tournaments/t1/categories/c1/stages/s1',
    });

    await screen.findByText('Alice');
    await user.click(screen.getByRole('checkbox', { name: /Alice/ }));
    await user.click(screen.getByRole('checkbox', { name: /Bob/ }));
    await user.click(screen.getByRole('button', { name: 'Generate fixtures' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Generate fixtures' }));

    expect(await screen.findByText('Could not generate fixtures')).toBeInTheDocument();
  });
});

/** Keeps the stub type referenced for readers of this file. */
export type { BadmintonApi };
