import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '@/api/context.tsx';
import { TournamentProvider } from '@/components/tournaments/context.tsx';
import { CourtBoardPage } from '@/pages/tournaments/court-board.tsx';
import { TournamentDashboardPage } from '@/pages/tournaments/dashboard.tsx';

import {
  createStubApi,
  makeDashboard,
  makeDashboardMatch,
  makeTournament,
} from '../../../tests/helpers.tsx';

const TOURNAMENT = makeTournament();

function renderPage(ui: React.ReactNode, api = createStubApi()) {
  render(
    <ApiProvider api={api}>
      <MemoryRouter>
        <TournamentProvider value={{ tournament: TOURNAMENT, refetch: vi.fn() }}>
          {ui}
        </TournamentProvider>
      </MemoryRouter>
    </ApiProvider>,
  );
  return api;
}

describe('TournamentDashboardPage', () => {
  it('renders the summary counts and match slices from one aggregated request', async () => {
    const api = createStubApi();
    vi.mocked(api.dashboard.get).mockResolvedValue(
      makeDashboard({
        liveMatches: [makeDashboardMatch({ status: 'IN_PROGRESS' })],
        upcomingMatches: [
          makeDashboardMatch({
            status: 'SCHEDULED',
            courtNumber: 1,
            scheduledStartAt: '2026-10-05T10:00:00.000Z',
          }),
        ],
        categories: [
          {
            categoryId: '22222222-2222-4222-8222-222222222222',
            name: 'Men Singles',
            code: 'MS',
            totalMatches: 6,
            completedMatches: 2,
            stages: [
              {
                stageId: '77777777-7777-4777-8777-777777777777',
                name: 'Group A',
                type: 'GROUP',
                status: 'ACTIVE',
                totalMatches: 6,
                completedMatches: 2,
              },
            ],
          },
        ],
      }),
    );

    renderPage(<TournamentDashboardPage />, api);

    expect(await screen.findByText('Live matches')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Unscheduled')).toBeInTheDocument();
    expect((await screen.findAllByText('Alice vs Bob')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Men Singles/)).length).toBeGreaterThan(0);
    expect(api.dashboard.get).toHaveBeenCalledWith(TOURNAMENT.id, expect.anything());
  });
});

describe('CourtBoardPage', () => {
  it('shows the live match against its court', async () => {
    const api = createStubApi();
    vi.mocked(api.dashboard.get).mockResolvedValue(
      makeDashboard({
        liveMatches: [
          makeDashboardMatch({
            status: 'IN_PROGRESS',
            courtId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            courtNumber: 1,
          }),
        ],
      }),
    );

    renderPage(<CourtBoardPage />, api);

    expect((await screen.findAllByText('Court 1')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0);
    expect(screen.getByText('vs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});
