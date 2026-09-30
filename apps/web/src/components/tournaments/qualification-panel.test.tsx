import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { QualificationPanel } from '@/components/tournaments/qualification-panel.tsx';

import { createStubApi, makeQualification, renderWithProviders } from '../../../tests/helpers.tsx';

const STAGE_ID = '77777777-7777-4777-8777-777777777777';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';

function renderPanel(options: { readonly generated?: boolean } = {}) {
  const api = createStubApi();
  const onGenerated = vi.fn();
  renderWithProviders(
    <QualificationPanel
      stageId={STAGE_ID}
      categoryId={CATEGORY_ID}
      bracketGenerated={options.generated ?? false}
      onGenerated={onGenerated}
    />,
    { api },
  );
  return { api, onGenerated };
}

describe('QualificationPanel', () => {
  it('shows the derived qualifiers and generates the bracket without UUID entry', async () => {
    const user = userEvent.setup();
    const { api, onGenerated } = renderPanel();

    // The group and its two qualifiers are named from the category entries.
    expect(await screen.findByText('Group A')).toBeInTheDocument();
    expect(await screen.findByTestId('qualification-summary')).toHaveTextContent('2 qualifiers');
    expect(screen.getByTestId('qualification-summary')).toHaveTextContent('2-entry bracket');

    await user.click(screen.getByRole('button', { name: 'Generate bracket from qualifiers' }));
    await user.click(await screen.findByRole('button', { name: 'Generate bracket' }));

    await waitFor(() => {
      expect(api.stages.generateBracketFromQualifiers).toHaveBeenCalledWith(STAGE_ID);
    });
    expect(onGenerated).toHaveBeenCalled();
  });

  it('blocks generation while the group stage is incomplete', async () => {
    const api = createStubApi();
    vi.mocked(api.stages.qualification).mockResolvedValue(
      makeQualification({
        ready: false,
        blockedReason: 'Every group match must be completed before qualifiers can be determined.',
        qualifierCount: 0,
        seeds: [],
      }),
    );
    renderWithProviders(
      <QualificationPanel
        stageId={STAGE_ID}
        categoryId={CATEGORY_ID}
        bracketGenerated={false}
        onGenerated={vi.fn()}
      />,
      { api },
    );

    expect(await screen.findByTestId('qualification-blocked')).toHaveTextContent(
      'Every group match must be completed',
    );
    expect(screen.getByRole('button', { name: 'Generate bracket from qualifiers' })).toBeDisabled();
  });

  it('hides generation once a bracket exists', async () => {
    renderPanel({ generated: true });

    expect(await screen.findByText('Group A')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Generate bracket from qualifiers' }),
    ).not.toBeInTheDocument();
  });

  it('prompts for the qualifier count when a group has none configured', async () => {
    const api = createStubApi();
    vi.mocked(api.stages.qualification).mockResolvedValue(
      makeQualification({ qualifiersPerGroup: null, ready: false, blockedReason: null }),
    );
    renderWithProviders(
      <QualificationPanel
        stageId={STAGE_ID}
        categoryId={CATEGORY_ID}
        bracketGenerated={false}
        onGenerated={vi.fn()}
      />,
      { api },
    );

    expect(await screen.findByTestId('qualification-config')).toHaveTextContent(
      'Set how many competitors qualify',
    );
  });

  it('shows an empty state when no group feeds the knockout', async () => {
    const api = createStubApi();
    vi.mocked(api.stages.qualification).mockResolvedValue(
      makeQualification({ groups: [], ready: false, blockedReason: 'No group stage feeds this.' }),
    );
    renderWithProviders(
      <QualificationPanel
        stageId={STAGE_ID}
        categoryId={CATEGORY_ID}
        bracketGenerated={false}
        onGenerated={vi.fn()}
      />,
      { api },
    );

    expect(await screen.findByText('No group stage feeds this knockout')).toBeInTheDocument();
  });
});
