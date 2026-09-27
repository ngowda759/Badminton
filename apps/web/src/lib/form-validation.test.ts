import { describe, expect, it } from 'vitest';

import {
  compactErrors,
  validateDateRange,
  validateOptionalEmail,
  validateOptionalPhone,
  validateOptionalPositiveInteger,
  validatePositiveInteger,
  validateRequired,
} from './form-validation.ts';

describe('validateRequired', () => {
  it('rejects blank and whitespace-only input', () => {
    expect(validateRequired('', 'Name')).toBe('Name is required.');
    expect(validateRequired('   ', 'Name')).toBe('Name is required.');
  });

  it('accepts a value within the limit and rejects one beyond it', () => {
    expect(validateRequired('Autumn Open', 'Name')).toBeUndefined();
    expect(validateRequired('x'.repeat(201), 'Name')).toBe('Name must be 200 characters or fewer.');
  });
});

describe('validateOptionalEmail', () => {
  it('allows an empty value', () => {
    expect(validateOptionalEmail('')).toBeUndefined();
  });

  it('accepts a valid address and rejects an invalid one', () => {
    expect(validateOptionalEmail('a@b.com')).toBeUndefined();
    expect(validateOptionalEmail('not-an-email')).toBe('Enter a valid email address.');
  });
});

describe('validateOptionalPhone', () => {
  it('allows an empty value and digits with an optional plus', () => {
    expect(validateOptionalPhone('')).toBeUndefined();
    expect(validateOptionalPhone('+91 90000 00001')).toBeUndefined();
  });

  it('rejects a number that is too short', () => {
    expect(validateOptionalPhone('123')).toBe('Enter a valid phone number (7-15 digits).');
  });
});

describe('validateDateRange', () => {
  it('requires both dates', () => {
    expect(validateDateRange('', '')).toEqual({
      startDate: 'Start date is required.',
      endDate: 'End date is required.',
    });
  });

  it('rejects an end date before the start date', () => {
    expect(validateDateRange('2026-10-05', '2026-10-01')).toEqual({
      endDate: 'End date must be on or after the start date.',
    });
  });

  it('accepts equal or later end dates', () => {
    expect(validateDateRange('2026-10-01', '2026-10-01')).toEqual({});
    expect(validateDateRange('2026-10-01', '2026-10-03')).toEqual({});
  });
});

describe('integer validation', () => {
  it('requires a positive whole number', () => {
    expect(validatePositiveInteger('0', 'Sequence')).toBe(
      'Sequence must be a positive whole number.',
    );
    expect(validatePositiveInteger('1.5', 'Sequence')).toBe(
      'Sequence must be a positive whole number.',
    );
    expect(validatePositiveInteger('3', 'Sequence')).toBeUndefined();
  });

  it('allows an empty optional value', () => {
    expect(validateOptionalPositiveInteger('', 'Draw size')).toBeUndefined();
  });
});

describe('compactErrors', () => {
  it('drops undefined entries', () => {
    expect(compactErrors({ a: undefined, b: 'problem' })).toEqual({ b: 'problem' });
  });
});
