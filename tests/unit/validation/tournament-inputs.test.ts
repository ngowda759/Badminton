import {
  addMatchParticipantInputSchema,
  createCategoryInputSchema,
  createPlayerInputSchema,
  createStageInputSchema,
  createTournamentInputSchema,
  registerTournamentEntryInputSchema,
  updateStageInputSchema,
} from '@badminton/validation';
import { describe, expect, it } from 'vitest';

/**
 * Application input schema tests.
 *
 * Verifies trimming, normalization, enum and numeric constraints and the date
 * normalization performed at the application boundary.
 */

describe('createTournamentInputSchema', () => {
  it('trims the name and normalizes the calendar date', () => {
    const parsed = createTournamentInputSchema.parse({
      name: '  Summer Open ',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      timezone: 'Asia/Kolkata',
    });
    expect(parsed.name).toBe('Summer Open');
    expect(parsed.startDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('rejects an empty name', () => {
    expect(
      createTournamentInputSchema.safeParse({
        name: '   ',
        startDate: '2026-10-01',
        endDate: '2026-10-03',
        timezone: 'Asia/Kolkata',
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(
      createTournamentInputSchema.safeParse({
        name: 'A',
        startDate: '01-10-2026',
        endDate: '2026-10-03',
        timezone: 'Asia/Kolkata',
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid timezone', () => {
    expect(
      createTournamentInputSchema.safeParse({
        name: 'A',
        startDate: '2026-10-01',
        endDate: '2026-10-03',
        timezone: 'Mars/Phobos',
      }).success,
    ).toBe(false);
  });

  it('normalizes a blank optional field to null', () => {
    const parsed = createTournamentInputSchema.parse({
      name: 'A',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
      timezone: 'Asia/Kolkata',
      description: '   ',
    });
    expect(parsed.description).toBeNull();
  });
});

describe('createCategoryInputSchema', () => {
  it('normalizes the code to upper case', () => {
    const parsed = createCategoryInputSchema.parse({
      name: 'Singles',
      code: ' ms ',
      format: 'SINGLES',
    });
    expect(parsed.code).toBe('MS');
  });

  it('rejects an over-long code', () => {
    expect(
      createCategoryInputSchema.safeParse({
        name: 'Singles',
        code: 'ABCDEFGHI',
        format: 'SINGLES',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown format', () => {
    expect(
      createCategoryInputSchema.safeParse({ name: 'S', code: 'S', format: 'TRIPLES' }).success,
    ).toBe(false);
  });
});

describe('createPlayerInputSchema', () => {
  it('normalizes the email to lower case', () => {
    const parsed = createPlayerInputSchema.parse({ name: 'A', email: 'A@B.COM' });
    expect(parsed.email).toBe('a@b.com');
  });

  it('rejects an invalid email', () => {
    expect(createPlayerInputSchema.safeParse({ name: 'A', email: 'not-an-email' }).success).toBe(
      false,
    );
  });

  it('normalizes a phone number to digits', () => {
    const parsed = createPlayerInputSchema.parse({ name: 'A', phone: '+91 90000-00001' });
    expect(parsed.phone).toBe('+919000000001');
  });

  it('rejects a too-short phone number', () => {
    expect(createPlayerInputSchema.safeParse({ name: 'A', phone: '123' }).success).toBe(false);
  });
});

describe('registerTournamentEntryInputSchema', () => {
  it('accepts a single-player registration', () => {
    const parsed = registerTournamentEntryInputSchema.parse({
      categoryId: '11111111-1111-4111-8111-111111111111',
      playerId: '22222222-2222-4222-8222-222222222222',
      seed: 2,
    });
    expect(parsed.seed).toBe(2);
  });

  it('rejects a non-uuid category id', () => {
    expect(registerTournamentEntryInputSchema.safeParse({ categoryId: 'nope' }).success).toBe(
      false,
    );
  });

  it('rejects a zero seed', () => {
    expect(
      registerTournamentEntryInputSchema.safeParse({
        categoryId: '11111111-1111-4111-8111-111111111111',
        playerId: '22222222-2222-4222-8222-222222222222',
        seed: 0,
      }).success,
    ).toBe(false);
  });
});

describe('addMatchParticipantInputSchema', () => {
  it('accepts slot 1 and slot 2', () => {
    expect(
      addMatchParticipantInputSchema.safeParse({
        entryId: '11111111-1111-4111-8111-111111111111',
        slot: 1,
      }).success,
    ).toBe(true);
    expect(
      addMatchParticipantInputSchema.safeParse({
        entryId: '11111111-1111-4111-8111-111111111111',
        slot: 2,
      }).success,
    ).toBe(true);
  });

  it('rejects slot 3', () => {
    expect(
      addMatchParticipantInputSchema.safeParse({
        entryId: '11111111-1111-4111-8111-111111111111',
        slot: 3,
      }).success,
    ).toBe(false);
  });
});

describe('createStageInputSchema knockout rules', () => {
  it('accepts a partial per-round catalogue', () => {
    const result = createStageInputSchema.safeParse({
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
      knockoutRules: { final: { format: 'single_game', pointsPerGame: 21 } },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a full catalogue', () => {
    const result = createStageInputSchema.safeParse({
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
      knockoutRules: {
        qf: { format: 'best_of_3', pointsPerGame: 11 },
        sf: { format: 'best_of_3', pointsPerGame: 15 },
        final: { format: 'best_of_3', pointsPerGame: 21 },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown round key', () => {
    expect(
      createStageInputSchema.safeParse({
        name: 'Knockout',
        type: 'KNOCKOUT',
        sequence: 1,
        knockoutRules: { semi: { format: 'best_of_3', pointsPerGame: 15 } },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown format', () => {
    expect(
      createStageInputSchema.safeParse({
        name: 'Knockout',
        type: 'KNOCKOUT',
        sequence: 1,
        knockoutRules: { qf: { format: 'best_of_5', pointsPerGame: 11 } },
      }).success,
    ).toBe(false);
  });

  it('rejects an out-of-range target', () => {
    for (const pointsPerGame of [0, 100]) {
      expect(
        createStageInputSchema.safeParse({
          name: 'Knockout',
          type: 'KNOCKOUT',
          sequence: 1,
          knockoutRules: { qf: { format: 'best_of_3', pointsPerGame } },
        }).success,
      ).toBe(false);
    }
  });

  it('allows clearing the catalogue through update', () => {
    expect(updateStageInputSchema.safeParse({ knockoutRules: null }).success).toBe(true);
  });
});
