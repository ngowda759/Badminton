import {
  BusinessRuleViolationError,
  InvalidStateTransitionError,
  ValidationError,
} from '@badminton/domain';
import { createRealtimeEventService, createTournamentService } from '@badminton/application';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';

/**
 * Tournament service unit tests against the fake repositories.
 *
 * Covers name/date/timezone rules, the DRAFT-on-create default and the allowed
 * lifecycle transitions.
 */

let repos: FakeRepositories;
let service: ReturnType<typeof createTournamentService>;

beforeEach(() => {
  repos = createFakeRepositories();
  service = createTournamentService(repos.client, repos.unitOfWork, createRealtimeEventService());
});

const validInput = {
  name: 'Summer Open',
  startDate: new Date('2026-10-01T00:00:00.000Z'),
  endDate: new Date('2026-10-03T00:00:00.000Z'),
  timezone: 'Asia/Kolkata',
};

describe('TournamentService.create', () => {
  it('creates a DRAFT tournament', async () => {
    const tournament = await service.create(validInput);
    expect(tournament.status).toBe('DRAFT');
    expect(tournament.name).toBe('Summer Open');
  });

  it('trims the name', async () => {
    const tournament = await service.create({ ...validInput, name: '  Summer Open  ' });
    expect(tournament.name).toBe('Summer Open');
  });

  it('rejects an empty name', async () => {
    await expect(service.create({ ...validInput, name: '   ' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects endDate before startDate', async () => {
    await expect(
      service.create({
        ...validInput,
        startDate: new Date('2026-10-05T00:00:00.000Z'),
        endDate: new Date('2026-10-03T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts endDate equal to startDate', async () => {
    const day = new Date('2026-10-03T00:00:00.000Z');
    const tournament = await service.create({ ...validInput, startDate: day, endDate: day });
    expect(tournament.id).toBeTruthy();
  });

  it('rejects an invalid IANA timezone', async () => {
    await expect(service.create({ ...validInput, timezone: 'IST' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a duplicate live name', async () => {
    await service.create(validInput);
    await expect(service.create(validInput)).rejects.toThrow(/already exists/i);
  });
});

describe('TournamentService.update', () => {
  it('rejects an invalid date range on update', async () => {
    const tournament = await service.create(validInput);
    await expect(
      service.update(tournament.id, { endDate: new Date('2026-09-01T00:00:00.000Z') }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('updates a draft tournament', async () => {
    const tournament = await service.create(validInput);
    const updated = await service.update(tournament.id, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
  });

  it('refuses to edit a cancelled tournament', async () => {
    const tournament = await service.create(validInput);
    await service.transitionStatus(tournament.id, { status: 'CANCELLED' });
    await expect(service.update(tournament.id, { name: 'Nope' })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });
});

describe('TournamentService.transitionStatus', () => {
  it('follows the forward lifecycle', async () => {
    const tournament = await service.create(validInput);
    await service.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });
    await service.transitionStatus(tournament.id, { status: 'REGISTRATION_CLOSED' });
    const final = await service.transitionStatus(tournament.id, { status: 'IN_PROGRESS' });
    expect(final.status).toBe('IN_PROGRESS');
  });

  it('cancels from a non-terminal state', async () => {
    const tournament = await service.create(validInput);
    const cancelled = await service.transitionStatus(tournament.id, { status: 'CANCELLED' });
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('rejects skipping a state', async () => {
    const tournament = await service.create(validInput);
    await expect(
      service.transitionStatus(tournament.id, { status: 'IN_PROGRESS' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('rejects any transition out of a terminal state', async () => {
    const tournament = await service.create(validInput);
    await service.transitionStatus(tournament.id, { status: 'CANCELLED' });
    await expect(
      service.transitionStatus(tournament.id, { status: 'DRAFT' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });
});

describe('TournamentService.list', () => {
  it('returns an empty page when there are no tournaments', async () => {
    const page = await service.list({ limit: 20 });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('returns tournaments newest first with a stable id tiebreaker', async () => {
    const created = [
      await service.create({ ...validInput, name: 'One' }),
      await service.create({ ...validInput, name: 'Two' }),
      await service.create({ ...validInput, name: 'Three' }),
    ];

    const page = await service.list({ limit: 20 });
    const expected = [...created].sort((left, right) => right.id.localeCompare(left.id));
    expect(page.items.map((tournament) => tournament.id)).toEqual(expected.map((item) => item.id));
  });

  it('caps the page at the requested limit and resumes after the cursor', async () => {
    const created = [
      await service.create({ ...validInput, name: 'One' }),
      await service.create({ ...validInput, name: 'Two' }),
      await service.create({ ...validInput, name: 'Three' }),
    ];

    const first = await service.list({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe(first.items[1]?.id ?? null);

    const second = await service.list({
      limit: 2,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const seen = [...first.items, ...second.items].map((tournament) => tournament.id);
    expect(new Set(seen)).toEqual(new Set(created.map((item) => item.id)));
  });
});
