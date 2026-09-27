import {
  bracketRoundName,
  BusinessRuleViolationError,
  calculateMatchesInRound,
  calculateNextBracketPosition,
  calculateNextMatchNumber,
  calculateNextRoundNumber,
  calculateNextSlot,
  calculateRoundCount,
  calculateSequence,
  calculateTotalMatches,
  isSupportedBracketSize,
  SUPPORTED_BRACKET_SIZES,
} from '@badminton/domain';
import { describe, expect, it } from 'vitest';

/**
 * Pure knockout bracket maths.
 *
 * These tests pin the single-elimination structure the rest of Phase 6 relies
 * on: which sizes are supported, how many rounds and matches a bracket has, and
 * how a match maps onto its destination in the next round.
 */

describe('isSupportedBracketSize', () => {
  it('accepts every supported power-of-two size', () => {
    for (const size of SUPPORTED_BRACKET_SIZES) {
      expect(isSupportedBracketSize(size)).toBe(true);
    }
  });

  it('rejects sizes that are not a power of two or exceed 128', () => {
    for (const size of [0, 1, 3, 5, 6, 7, 9, 12, 31, 100, 256, -4, 2.5]) {
      expect(isSupportedBracketSize(size)).toBe(false);
    }
  });
});

describe('calculateRoundCount', () => {
  it('is log2 of the bracket size', () => {
    expect(calculateRoundCount(2)).toBe(1);
    expect(calculateRoundCount(4)).toBe(2);
    expect(calculateRoundCount(8)).toBe(3);
    expect(calculateRoundCount(16)).toBe(4);
    expect(calculateRoundCount(128)).toBe(7);
  });

  it('rejects an unsupported size', () => {
    expect(() => calculateRoundCount(6)).toThrow(BusinessRuleViolationError);
  });
});

describe('calculateMatchesInRound', () => {
  it('halves the match count each round and ends with the final', () => {
    expect(calculateMatchesInRound(8, 1)).toBe(4);
    expect(calculateMatchesInRound(8, 2)).toBe(2);
    expect(calculateMatchesInRound(8, 3)).toBe(1);

    expect(calculateMatchesInRound(16, 1)).toBe(8);
    expect(calculateMatchesInRound(16, 2)).toBe(4);
    expect(calculateMatchesInRound(16, 3)).toBe(2);
    expect(calculateMatchesInRound(16, 4)).toBe(1);
  });

  it('handles the smallest bracket', () => {
    expect(calculateMatchesInRound(2, 1)).toBe(1);
  });

  it('rejects a round outside the bracket', () => {
    expect(() => calculateMatchesInRound(8, 0)).toThrow(BusinessRuleViolationError);
    expect(() => calculateMatchesInRound(8, 4)).toThrow(BusinessRuleViolationError);
  });
});

describe('calculateTotalMatches', () => {
  it('is size - 1 for a single-elimination bracket', () => {
    expect(calculateTotalMatches(2)).toBe(1);
    expect(calculateTotalMatches(4)).toBe(3);
    expect(calculateTotalMatches(8)).toBe(7);
    expect(calculateTotalMatches(16)).toBe(15);
    expect(calculateTotalMatches(128)).toBe(127);
  });
});

describe('next-round calculations', () => {
  it('advances the round by one', () => {
    expect(calculateNextRoundNumber(1)).toBe(2);
    expect(calculateNextRoundNumber(4)).toBe(5);
  });

  it('maps pairs of matches onto one next-round match', () => {
    expect(calculateNextMatchNumber(1)).toBe(1);
    expect(calculateNextMatchNumber(2)).toBe(1);
    expect(calculateNextMatchNumber(3)).toBe(2);
    expect(calculateNextMatchNumber(4)).toBe(2);
    expect(calculateNextMatchNumber(5)).toBe(3);
    expect(calculateNextMatchNumber(8)).toBe(4);
  });

  it('sends odd match numbers to slot 1 and even to slot 2', () => {
    expect(calculateNextSlot(1)).toBe(1);
    expect(calculateNextSlot(2)).toBe(2);
    expect(calculateNextSlot(3)).toBe(1);
    expect(calculateNextSlot(4)).toBe(2);
  });

  it('combines round, match and slot for the whole bracket size range', () => {
    // A 16-entry bracket: the first-round matches feed the quarterfinals.
    expect(calculateNextBracketPosition(1, 1)).toEqual({
      roundNumber: 2,
      matchNumber: 1,
      slot: 1,
    });
    expect(calculateNextBracketPosition(1, 2)).toEqual({
      roundNumber: 2,
      matchNumber: 1,
      slot: 2,
    });
    expect(calculateNextBracketPosition(1, 8)).toEqual({
      roundNumber: 2,
      matchNumber: 4,
      slot: 2,
    });
    // Semifinal winners feed the final.
    expect(calculateNextBracketPosition(2, 1)).toEqual({
      roundNumber: 3,
      matchNumber: 1,
      slot: 1,
    });
    expect(calculateNextBracketPosition(2, 2)).toEqual({
      roundNumber: 3,
      matchNumber: 1,
      slot: 2,
    });
  });
});

describe('calculateSequence', () => {
  it('lays rounds out consecutively and ends on the final', () => {
    // 8-entry bracket: QF 1..4, SF 5..6, Final 7.
    expect(calculateSequence(8, 1, 1)).toBe(1);
    expect(calculateSequence(8, 1, 4)).toBe(4);
    expect(calculateSequence(8, 2, 1)).toBe(5);
    expect(calculateSequence(8, 2, 2)).toBe(6);
    expect(calculateSequence(8, 3, 1)).toBe(7);
  });

  it('produces a contiguous, unique sequence for the whole bracket', () => {
    const size = 16;
    const sequences: number[] = [];
    for (let round = 1; round <= calculateRoundCount(size); round += 1) {
      for (let match = 1; match <= calculateMatchesInRound(size, round); match += 1) {
        sequences.push(calculateSequence(size, round, match));
      }
    }
    expect(sequences).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
  });

  it('rejects a match outside its round', () => {
    expect(() => calculateSequence(8, 1, 5)).toThrow(BusinessRuleViolationError);
  });
});

describe('bracketRoundName', () => {
  it('names rounds from the final backwards', () => {
    expect(bracketRoundName(8, 3)).toBe('Final');
    expect(bracketRoundName(8, 2)).toBe('Semifinals');
    expect(bracketRoundName(8, 1)).toBe('Quarterfinals');

    expect(bracketRoundName(16, 4)).toBe('Final');
    expect(bracketRoundName(16, 3)).toBe('Semifinals');
    expect(bracketRoundName(16, 2)).toBe('Quarterfinals');
    expect(bracketRoundName(16, 1)).toBe('Round of 16');

    expect(bracketRoundName(2, 1)).toBe('Final');
    expect(bracketRoundName(4, 1)).toBe('Semifinals');
    expect(bracketRoundName(128, 1)).toBe('Round of 128');
  });

  it('rejects a round outside the bracket', () => {
    expect(() => bracketRoundName(8, 4)).toThrow(BusinessRuleViolationError);
  });
});
