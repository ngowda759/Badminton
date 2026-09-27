import {
  ACTIVE_ENTRY_STATUSES,
  CATEGORY_TRANSITIONS,
  ENTRY_TRANSITIONS,
  isValidCategoryCode,
  isValidIanaTimezone,
  isAllowedTransition,
  isDateRangeValid,
  isTerminal,
  MATCH_TRANSITIONS,
  normalizeCategoryCode,
  normalizeEmail,
  normalizeOptionalContact,
  normalizePhone,
  normalizeWhitespace,
  STAGE_TRANSITIONS,
  toCalendarDate,
  TOURNAMENT_TRANSITIONS,
} from '@badminton/domain';
import { describe, expect, it } from 'vitest';

/**
 * Domain helper unit tests.
 *
 * These cover the pure rules: normalization, calendar dates, IANA timezone
 * acceptance and the lifecycle transition tables.
 */

describe('normalization', () => {
  it('collapses whitespace in a name', () => {
    expect(normalizeWhitespace('  A   B  ')).toBe('A B');
  });

  it('normalizes a category code', () => {
    expect(normalizeCategoryCode(' m s ')).toBe('MS');
    expect(normalizeCategoryCode('x d')).toBe('XD');
  });

  it('validates the category code format', () => {
    expect(isValidCategoryCode('MS-1')).toBe(true);
    expect(isValidCategoryCode('ms')).toBe(false);
    expect(isValidCategoryCode('ABCDEFGHI')).toBe(false);
    expect(isValidCategoryCode('')).toBe(false);
  });

  it('normalizes email casing', () => {
    expect(normalizeEmail(' A@B.COM ')).toBe('a@b.com');
  });

  it('normalizes phone numbers', () => {
    expect(normalizePhone('+91 90000 00001')).toBe('+919000000001');
    expect(normalizePhone('+91-9000000001')).toBe('+919000000001');
    expect(normalizePhone('9000000001')).toBe('9000000001');
  });

  it('maps blank optional contacts to null', () => {
    expect(normalizeOptionalContact('  ', normalizeEmail)).toBeNull();
    expect(normalizeOptionalContact(undefined, normalizeEmail)).toBeNull();
    expect(normalizeOptionalContact('A@B.com', normalizeEmail)).toBe('a@b.com');
  });
});

describe('calendar dates', () => {
  it('truncates to UTC midnight', () => {
    const value = new Date('2026-10-01T18:30:00.000Z');
    expect(toCalendarDate(value).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('compares ranges by calendar date', () => {
    expect(
      isDateRangeValid(new Date('2026-10-01T23:00:00.000Z'), new Date('2026-10-01T01:00:00.000Z')),
    ).toBe(true);
    expect(
      isDateRangeValid(new Date('2026-10-02T00:00:00.000Z'), new Date('2026-10-01T00:00:00.000Z')),
    ).toBe(false);
  });
});

describe('IANA timezones', () => {
  it('accepts canonical Area/Location names and UTC', () => {
    expect(isValidIanaTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidIanaTimezone('Europe/London')).toBe(true);
    expect(isValidIanaTimezone('UTC')).toBe(true);
  });

  it('rejects ambiguous abbreviations', () => {
    expect(isValidIanaTimezone('IST')).toBe(false);
    expect(isValidIanaTimezone('PST')).toBe(false);
    expect(isValidIanaTimezone('GMT')).toBe(false);
  });

  it('rejects unknown zones and blanks', () => {
    expect(isValidIanaTimezone('Mars/Phobos')).toBe(false);
    expect(isValidIanaTimezone('   ')).toBe(false);
  });
});

describe('lifecycle tables', () => {
  it('allows the forward tournament path and rejects skips', () => {
    expect(isAllowedTransition(TOURNAMENT_TRANSITIONS, 'DRAFT', 'REGISTRATION_OPEN')).toBe(true);
    expect(isAllowedTransition(TOURNAMENT_TRANSITIONS, 'DRAFT', 'IN_PROGRESS')).toBe(false);
  });

  it('treats terminal tournament states as terminal', () => {
    expect(isTerminal(TOURNAMENT_TRANSITIONS, 'COMPLETED')).toBe(true);
    expect(isTerminal(TOURNAMENT_TRANSITIONS, 'CANCELLED')).toBe(true);
    expect(isTerminal(TOURNAMENT_TRANSITIONS, 'IN_PROGRESS')).toBe(false);
  });

  it('allows cancelling from every non-terminal tournament state', () => {
    for (const status of [
      'DRAFT',
      'REGISTRATION_OPEN',
      'REGISTRATION_CLOSED',
      'IN_PROGRESS',
    ] as const) {
      expect(isAllowedTransition(TOURNAMENT_TRANSITIONS, status, 'CANCELLED')).toBe(true);
    }
  });

  it('exposes category, entry, stage and match transitions', () => {
    expect(isAllowedTransition(CATEGORY_TRANSITIONS, 'DRAFT', 'OPEN')).toBe(true);
    expect(isAllowedTransition(ENTRY_TRANSITIONS, 'PENDING', 'CONFIRMED')).toBe(true);
    expect(isAllowedTransition(ENTRY_TRANSITIONS, 'CONFIRMED', 'PENDING')).toBe(false);
    expect(isAllowedTransition(STAGE_TRANSITIONS, 'PENDING', 'ACTIVE')).toBe(true);
    expect(isAllowedTransition(MATCH_TRANSITIONS, 'SCHEDULED', 'IN_PROGRESS')).toBe(true);
  });

  it('lists active entry statuses as the non-terminal ones', () => {
    expect(ACTIVE_ENTRY_STATUSES).toEqual(['PENDING', 'CONFIRMED']);
  });
});
