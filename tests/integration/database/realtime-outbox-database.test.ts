import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createRealtimeEventService } from '@badminton/application';
import type { PrismaClient } from '@badminton/database';
import {
  createPrismaUnitOfWork,
  createPostgresRealtimeEventNotifier,
  createRepositoryClient,
} from '@badminton/infrastructure';

import {
  createTournament,
  openTestDatabase,
  resetTournamentData,
  resolveTestDatabaseUrl,
} from './harness.ts';

/**
 * Phase 8.1 database integration tests (real PostgreSQL, no Prisma mocks).
 *
 * They prove the transactional-outbox guarantees the architecture depends on:
 * the event row is written through the application repository port inside the
 * business transaction, pending events are read oldest-first, `markPublished`
 * is durable, and the `NOTIFY` trigger fires only on commit - so a rolled-back
 * change never wakes the dispatcher, and a lost notification is recovered from
 * the durable row.
 */

const database = await openTestDatabase('_phase8_test');

afterAll(async () => {
  await database?.disconnect();
});

const SUITE_NAME = 'Phase 8 realtime outbox database';

function registerDatabaseSuite(prisma: PrismaClient): void {
  describe(SUITE_NAME, () => {
    const client = createRepositoryClient(prisma);
    const unitOfWork = createPrismaUnitOfWork(prisma);
    const events = createRealtimeEventService();

    beforeEach(async () => {
      await resetTournamentData(prisma);
    });

    it('persists an event created inside a committed transaction', async () => {
      const tournament = await createTournament(prisma);

      const created = await unitOfWork.runInTransaction((tx) =>
        events.record(tx, {
          tournamentId: tournament.id,
          eventType: 'MATCH_COMPLETED',
          aggregateType: 'MATCH',
          aggregateId: tournament.id,
        }),
      );

      const pending = await client.realtimeEvents.getPendingEvents(10);
      expect(pending.map((event) => event.id)).toEqual([created.id]);
      expect(pending[0]?.payload).toBeNull();
    });

    it('discards the event when the transaction rolls back', async () => {
      const tournament = await createTournament(prisma);

      await expect(
        unitOfWork.runInTransaction(async (tx) => {
          await events.record(tx, {
            tournamentId: tournament.id,
            eventType: 'COURT_CREATED',
            aggregateType: 'COURT',
            aggregateId: tournament.id,
          });
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');

      expect(await client.realtimeEvents.getPendingEvents(10)).toHaveLength(0);
    });

    it('reads pending events oldest-first and excludes published ones', async () => {
      const tournament = await createTournament(prisma);

      const first = await events.record(client, {
        tournamentId: tournament.id,
        eventType: 'MATCH_STARTED',
        aggregateType: 'MATCH',
        aggregateId: tournament.id,
      });
      const second = await events.record(client, {
        tournamentId: tournament.id,
        eventType: 'MATCH_COMPLETED',
        aggregateType: 'MATCH',
        aggregateId: tournament.id,
      });

      await client.realtimeEvents.markPublished(first.id);

      const pending = await client.realtimeEvents.getPendingEvents(10);
      expect(pending.map((event) => event.id)).toEqual([second.id]);
      expect(pending[0]?.publishedAt).toBeNull();
    });

    it('markPublished is durable and idempotent', async () => {
      const tournament = await createTournament(prisma);
      const event = await events.record(client, {
        tournamentId: tournament.id,
        eventType: 'MATCH_CANCELLED',
        aggregateType: 'MATCH',
        aggregateId: tournament.id,
      });

      await client.realtimeEvents.markPublished(event.id);
      const firstStamp = (await prisma.realtimeEvent.findUnique({ where: { id: event.id } }))
        ?.publishedAt;

      await client.realtimeEvents.markPublished(event.id);
      const secondStamp = (await prisma.realtimeEvent.findUnique({ where: { id: event.id } }))
        ?.publishedAt;

      expect(firstStamp).toBeInstanceOf(Date);
      expect(secondStamp?.getTime()).toBe(firstStamp?.getTime());
    });

    it('round-trips a small payload through the JSON column', async () => {
      const tournament = await createTournament(prisma);
      const event = await events.record(client, {
        tournamentId: tournament.id,
        eventType: 'COURT_UPDATED',
        aggregateType: 'COURT',
        aggregateId: tournament.id,
        payload: { number: 3, name: 'Court Three' },
      });

      expect(event.payload).toEqual({ number: 3, name: 'Court Three' });
    });

    it('notifies listeners only after the inserting transaction commits', async () => {
      const tournament = await createTournament(prisma);
      const url = resolveTestDatabaseUrl('_phase8_test');
      if (!url) {
        throw new Error('Expected the test database URL to be available.');
      }

      const notifier = createPostgresRealtimeEventNotifier({ connectionString: url });
      const signals: string[] = [];
      await notifier.listen((tournamentId) => signals.push(tournamentId));

      try {
        // A rolled-back insert must not fire NOTIFY.
        await expect(
          unitOfWork.runInTransaction(async (tx) => {
            await events.record(tx, {
              tournamentId: tournament.id,
              eventType: 'MATCH_STARTED',
              aggregateType: 'MATCH',
              aggregateId: tournament.id,
            });
            throw new Error('rollback');
          }),
        ).rejects.toThrow('rollback');
        await delay(150);
        expect(signals).toHaveLength(0);

        // A committed insert fires exactly one NOTIFY carrying the tournament id.
        await unitOfWork.runInTransaction((tx) =>
          events.record(tx, {
            tournamentId: tournament.id,
            eventType: 'MATCH_COMPLETED',
            aggregateType: 'MATCH',
            aggregateId: tournament.id,
          }),
        );
        await waitFor(() => signals.length > 0);
        expect(signals).toEqual([tournament.id]);
      } finally {
        await notifier.close();
      }
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `condition` until it is true or the budget runs out. */
async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await delay(25);
  }
}

if (database) {
  registerDatabaseSuite(database.prisma);
} else {
  describe.skip(SUITE_NAME, () => {});
}
