import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from '@/components/status-badge.tsx';

import { renderWithProviders } from '../../tests/helpers.tsx';

describe('StatusBadge', () => {
  it('renders a friendly label rather than the raw enum', () => {
    renderWithProviders(<StatusBadge kind="tournament" status="REGISTRATION_OPEN" />);
    expect(screen.getByText('Registration open')).toBeInTheDocument();
  });

  it('uses the same presentation across pages for the same status', () => {
    renderWithProviders(
      <>
        <StatusBadge kind="category" status="OPEN" />
        <StatusBadge kind="entry" status="CONFIRMED" />
      </>,
    );
    // Both are success-toned in the shared table.
    const badges = screen.getAllByText(/Open|Confirmed/);
    expect(badges).toHaveLength(2);
  });

  it('falls back to the raw value for an unknown status', () => {
    renderWithProviders(<StatusBadge kind="stage" status="SOMETHING_NEW" />);
    expect(screen.getByText('SOMETHING_NEW')).toBeInTheDocument();
  });
});
