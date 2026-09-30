import {
  BusinessRuleViolationError,
  flattenQualifiers,
  selectQualifiers,
  validateQualificationConfig,
  type QualificationStanding,
} from '@badminton/domain';
import { describe, expect, it } from 'vitest';

/**
 * Pure qualification-selection tests.
 *
 * Qualification is the top `qualifiersPerGroup` of each group, in standing
 * order, and it must refuse to run while any group match is outstanding. These
 * tests exercise the selection, the small-group clamp and the incomplete-stage
 * guard without any persistence.
 */

function standings(...entryIds: string[]): readonly QualificationStanding[] {
  return entryIds.map((entryId, index) => ({ entryId, position: index + 1 }));
}

describe('validateQualificationConfig', () => {
  it('accepts a positive whole number', () => {
    expect(() => {
      validateQualificationConfig({ qualifiersPerGroup: 2 });
    }).not.toThrow();
  });

  it('rejects zero, negatives and fractions', () => {
    for (const value of [0, -1, 1.5]) {
      expect(() => {
        validateQualificationConfig({ qualifiersPerGroup: value });
      }).toThrow(BusinessRuleViolationError);
    }
  });
});

describe('selectQualifiers', () => {
  it('takes the top N of each group in standing order', () => {
    const groups = new Map([
      ['g1', standings('a1', 'a2', 'a3')],
      ['g2', standings('b1', 'b2', 'b3')],
    ]);
    const result = selectQualifiers({ qualifiersPerGroup: 2 }, groups, 0);

    expect(result.groups).toEqual([
      { groupId: 'g1', entryIds: ['a1', 'a2'] },
      { groupId: 'g2', entryIds: ['b1', 'b2'] },
    ]);
    expect(result.qualifierCount).toBe(4);
  });

  it('clamps to the group size when it is smaller than the configured count', () => {
    const groups = new Map([['g1', standings('a1', 'a2')]]);
    const result = selectQualifiers({ qualifiersPerGroup: 4 }, groups, 0);

    expect(result.groups[0]?.entryIds).toEqual(['a1', 'a2']);
    expect(result.qualifierCount).toBe(2);
  });

  it('selects nobody from an empty group', () => {
    const groups = new Map([['g1', standings()]]);
    const result = selectQualifiers({ qualifiersPerGroup: 2 }, groups, 0);

    expect(result.groups[0]?.entryIds).toEqual([]);
    expect(result.qualifierCount).toBe(0);
  });

  it('orders each group by the standings positions, not the map order', () => {
    const groups = new Map([
      [
        'g1',
        [
          { entryId: 'third', position: 3 },
          { entryId: 'first', position: 1 },
          { entryId: 'second', position: 2 },
        ],
      ],
    ]);
    const result = selectQualifiers({ qualifiersPerGroup: 2 }, groups, 0);
    expect(result.groups[0]?.entryIds).toEqual(['first', 'second']);
  });

  it('refuses to qualify while a group match is outstanding', () => {
    const groups = new Map([['g1', standings('a1', 'a2')]]);
    expect(() => selectQualifiers({ qualifiersPerGroup: 1 }, groups, 1)).toThrow(
      BusinessRuleViolationError,
    );
  });

  it('rejects a negative pending count', () => {
    expect(() => selectQualifiers({ qualifiersPerGroup: 1 }, new Map(), -1)).toThrow(
      BusinessRuleViolationError,
    );
  });
});

describe('flattenQualifiers', () => {
  it('concatenates groups in order, each in standing order', () => {
    const result = selectQualifiers(
      { qualifiersPerGroup: 2 },
      new Map([
        ['g1', standings('a1', 'a2')],
        ['g2', standings('b1', 'b2')],
      ]),
      0,
    );
    expect(flattenQualifiers(result)).toEqual(['a1', 'a2', 'b1', 'b2']);
  });
});
