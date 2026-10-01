import { useMemo } from 'react';

import type { KnockoutRuleDto } from '@/api/types.ts';
import { FormField } from '@/components/form-field.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import {
  defaultKnockoutRuleForRound,
  knockoutRoundKeysForBracket,
  knockoutRoundLabel,
  type KnockoutFormat,
  type KnockoutRoundKey,
} from '@/lib/scoring.ts';

export interface KnockoutRulesEditorProps {
  /** The bracket size the knockout will use; drives which rounds are shown. */
  readonly drawSize: number | null;
  readonly rules: Readonly<Record<string, KnockoutRuleDto>> | null;
  readonly disabled: boolean;
  readonly onChange: (rules: Readonly<Record<string, KnockoutRuleDto>>) => void;
}

/**
 * Per-round knockout scoring configuration.
 *
 * Each round the bracket plays gets a match format (Best of 3 / Straight set)
 * and a points target. The defaults mirror the original tournament (QF 11,
 * SF 15, Final 21, best of three) and the configuration is locked once the
 * bracket exists, so a live match can never be re-interpreted.
 */
export function KnockoutRulesEditor({
  drawSize,
  rules,
  disabled,
  onChange,
}: KnockoutRulesEditorProps) {
  const rounds = useMemo(
    () =>
      drawSize === null
        ? (['qf', 'sf', 'final'] as KnockoutRoundKey[])
        : knockoutRoundKeysForBracket(drawSize),
    [drawSize],
  );

  const ruleFor = (key: KnockoutRoundKey): KnockoutRuleDto =>
    rules?.[key] ?? defaultKnockoutRuleForRound(key);

  const update = (key: KnockoutRoundKey, patch: Partial<KnockoutRuleDto>): void => {
    const next: Record<string, KnockoutRuleDto> = {};
    for (const round of rounds) {
      next[round] = ruleFor(round);
    }
    next[key] = { ...ruleFor(key), ...patch };
    onChange(next);
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="knockout-rules-editor">
      {rounds.map((key) => {
        const rule = ruleFor(key);
        return (
          <div key={key} className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">{knockoutRoundLabel(key)}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={`${knockoutRoundLabel(key)} format`} htmlFor={`rule-${key}-format`}>
                {({ id }) => (
                  <Select
                    value={rule.format}
                    disabled={disabled}
                    onValueChange={(value) => {
                      update(key, { format: value as KnockoutFormat });
                    }}
                  >
                    <SelectTrigger id={id} aria-label={`${knockoutRoundLabel(key)} format`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="best_of_3">Best of 3</SelectItem>
                      <SelectItem value="single_game">Straight set</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField label={`${knockoutRoundLabel(key)} points`} htmlFor={`rule-${key}-points`}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={99}
                    disabled={disabled}
                    aria-label={`${knockoutRoundLabel(key)} points per game`}
                    value={rule.pointsPerGame}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      if (Number.isInteger(parsed)) {
                        update(key, { pointsPerGame: parsed });
                      }
                    }}
                  />
                )}
              </FormField>
            </div>
          </div>
        );
      })}
    </div>
  );
}
