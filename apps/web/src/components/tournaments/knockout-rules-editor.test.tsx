import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KnockoutRulesEditor } from '@/components/tournaments/knockout-rules-editor.tsx';

function renderEditor(
  options: {
    readonly drawSize?: number | null;
    readonly rules?: Readonly<
      Record<string, { format: 'best_of_3' | 'single_game'; pointsPerGame: number }>
    > | null;
    readonly disabled?: boolean;
  } = {},
) {
  const onChange = vi.fn();
  render(
    <KnockoutRulesEditor
      drawSize={options.drawSize ?? null}
      rules={options.rules ?? null}
      disabled={options.disabled ?? false}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe('KnockoutRulesEditor', () => {
  it('renders the V1 default rounds and targets when no catalogue is supplied', () => {
    renderEditor();

    expect(screen.getByText('Quarter-Final')).toBeInTheDocument();
    expect(screen.getByText('Semi-Final')).toBeInTheDocument();
    expect(screen.getByText('Final')).toBeInTheDocument();
    expect(screen.getByLabelText('Quarter-Final points per game')).toHaveValue(11);
    expect(screen.getByLabelText('Semi-Final points per game')).toHaveValue(15);
    expect(screen.getByLabelText('Final points per game')).toHaveValue(21);
  });

  it('derives the rounds from the bracket size', () => {
    renderEditor({ drawSize: 4 });

    expect(screen.getByText('Semi-Final')).toBeInTheDocument();
    expect(screen.getByText('Final')).toBeInTheDocument();
    expect(screen.queryByText('Quarter-Final')).not.toBeInTheDocument();
  });

  it('emits a full catalogue when a round target changes', () => {
    const { onChange } = renderEditor();

    // `change` fires once with the complete value, so the controlled input is
    // never re-parsed digit by digit.
    fireEvent.change(screen.getByLabelText('Final points per game'), { target: { value: '25' } });

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last.final).toEqual({ format: 'best_of_3', pointsPerGame: 25 });
    // Every visible round is carried so the API normalizes a complete catalogue.
    expect(Object.keys(last).sort()).toEqual(['final', 'qf', 'sf']);
  });

  it('disables the controls once the knockout has started', () => {
    renderEditor({ disabled: true });

    expect(screen.getByLabelText('Quarter-Final points per game')).toBeDisabled();
    expect(screen.getByLabelText('Final points per game')).toBeDisabled();
  });
});
