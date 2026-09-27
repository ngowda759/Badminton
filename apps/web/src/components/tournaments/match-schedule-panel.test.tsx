import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MatchSchedulePanel } from '@/components/tournaments/match-schedule-panel.tsx';

import {
  createStubApi,
  makeCourt,
  makeMatch,
  renderWithProviders,
} from '../../../tests/helpers.tsx';

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const COURT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function renderPanel(match = makeMatch()) {
  const api = createStubApi();
  vi.mocked(api.courts.listByTournament).mockResolvedValue([makeCourt()]);
  const onChanged = vi.fn();
  renderWithProviders(
    <MatchSchedulePanel match={match} tournamentId={TOURNAMENT_ID} onChanged={onChanged} />,
    { api },
  );
  return { api, onChanged };
}

describe('MatchSchedulePanel', () => {
  it('schedules a match with the selected court and window', async () => {
    const user = userEvent.setup();
    const { api, onChanged } = renderPanel();

    await waitFor(() => {
      expect(screen.getByLabelText('Court')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Court'));
    await user.click(screen.getByRole('option', { name: /Court 1/ }));
    await user.type(screen.getByLabelText(/^Start/), '2026-10-05T10:00');
    await user.type(screen.getByLabelText(/^End/), '2026-10-05T10:30');
    await user.click(screen.getByRole('button', { name: 'Schedule match' }));

    await waitFor(() => {
      expect(api.matches.schedule).toHaveBeenCalledWith(
        '88888888-8888-4888-8888-888888888888',
        expect.objectContaining({ courtId: COURT_ID }),
      );
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('clears a schedule from a scheduled match', async () => {
    const user = userEvent.setup();
    const { api, onChanged } = renderPanel(
      makeMatch({
        courtId: COURT_ID,
        scheduledStartAt: '2026-10-05T10:00:00.000Z',
        scheduledEndAt: '2026-10-05T10:30:00.000Z',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Clear schedule' }));

    await waitFor(() => {
      expect(api.matches.unschedule).toHaveBeenCalledWith('88888888-8888-4888-8888-888888888888');
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('is read-only for a completed match', () => {
    renderPanel(makeMatch({ status: 'COMPLETED' }));

    expect(
      screen.getByText('A match can only be scheduled or cleared while it is scheduled.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schedule match' })).not.toBeInTheDocument();
  });

  it('requires a court before submitting', async () => {
    const user = userEvent.setup();
    const { api } = renderPanel();

    await user.type(screen.getByLabelText(/^Start/), '2026-10-05T10:00');
    await user.type(screen.getByLabelText(/^End/), '2026-10-05T10:30');
    await user.click(screen.getByRole('button', { name: 'Schedule match' }));

    expect(await screen.findByText('Court is required.')).toBeInTheDocument();
    expect(api.matches.schedule).not.toHaveBeenCalled();
  });
});
