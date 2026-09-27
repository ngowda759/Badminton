import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/client.ts';
import { TournamentForm } from '@/components/tournaments/tournament-form.tsx';

import { renderWithProviders } from '../../../tests/helpers.tsx';

const BASE_VALUES = {
  name: 'Autumn Open',
  description: '',
  startDate: '2026-10-01',
  endDate: '2026-10-03',
  location: '',
  timezone: 'UTC',
};

function renderForm(onSubmit: (values: typeof BASE_VALUES) => Promise<unknown>) {
  return renderWithProviders(
    <TournamentForm
      initialValues={BASE_VALUES}
      submitLabel="Create tournament"
      timezoneEditable
      onSubmit={onSubmit}
      onCancel={() => undefined}
    />,
  );
}

describe('TournamentForm', () => {
  it('requires a name', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => Promise.resolve(undefined));
    renderForm(onSubmit);

    await user.clear(screen.getByLabelText(/^Name/));
    await user.click(screen.getByRole('button', { name: 'Create tournament' }));

    expect(await screen.findByText('Name is required.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects an end date before the start date', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => Promise.resolve(undefined));
    renderForm(onSubmit);

    const end = screen.getByLabelText(/^End date/);
    await user.clear(end);
    await user.type(end, '2026-09-01');
    await user.click(screen.getByRole('button', { name: 'Create tournament' }));

    expect(
      await screen.findByText('End date must be on or after the start date.'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits valid values', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => Promise.resolve(undefined));
    renderForm(onSubmit);

    await user.click(screen.getByRole('button', { name: 'Create tournament' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Autumn Open', timezone: 'UTC' }),
    );
  });

  it('disables the submit button while the request is pending', async () => {
    const user = userEvent.setup();
    let resolve!: () => void;
    const pending = new Promise<undefined>((res) => {
      resolve = () => {
        res(undefined);
      };
    });
    renderForm(() => pending);

    const submit = screen.getByRole('button', { name: 'Create tournament' });
    await user.click(submit);

    const busy = await screen.findByRole('button', { name: 'Saving…' });
    expect(busy).toBeDisabled();

    resolve();
  });

  it('preserves entered values and shows a server conflict message', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() =>
      Promise.reject(new ApiError(409, 'CONFLICT', 'A tournament with this name already exists.')),
    );
    renderForm(onSubmit);

    await user.type(screen.getByLabelText(/^Name/), ' extra');
    await user.click(screen.getByRole('button', { name: 'Create tournament' }));

    expect(
      await screen.findByText('A tournament with this name already exists.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Autumn Open extra');
  });

  it('merges server field errors onto the matching field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() =>
      Promise.reject(
        new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed.', [
          { path: 'name', message: 'Name must be at most 200 characters.' },
        ]),
      ),
    );
    renderForm(onSubmit);

    await user.click(screen.getByRole('button', { name: 'Create tournament' }));

    expect(await screen.findByText('Name must be at most 200 characters.')).toBeInTheDocument();
  });

  it('never displays raw internal error text', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() =>
      Promise.reject(new Error('PrismaClientKnownRequestError: SQLSTATE 23505')),
    );
    renderForm(onSubmit);

    await user.click(screen.getByRole('button', { name: 'Create tournament' }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/Prisma/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SQLSTATE/)).not.toBeInTheDocument();
  });
});
