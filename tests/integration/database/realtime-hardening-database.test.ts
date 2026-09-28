import { describe, expect, it, beforeEach, afterAll } from 'vitest';

import { createRealtimeDispatcher, createRealtimeEventPublisher } from '@badminton/application';
import type { PrismaClient } from '@badminton/database';
import { createRepositoryClient } from '@badminton/infrastructure';

import { createTournament, openTestDatabase, resetTournamentData } from './harness.ts';

/**
 * Phase 8.6 realtime outbox load/scale and index tests (real PostgreSQL).
 *
 * These are not production benchmarks. They verify, against the real database
 * and the real repository adapter, that a reasonable local backlog is:
 *
 * - read in a bounded, oldest-first batch (the dispatcher never loads the whole
 *   table);
 * - fully drained, with tournament isolation preserved under volume (a
 *   Tournament A event never reaches a Tournament B sink);
 * - still correct when two dispatchers drain concurrently (at-least-once, no
 *   lost rows);
 * - supported by the two documented indexes on `realtime_events`.
 */

const database = await openTestDatabase('_phase86_test');

afterAll(async () => {
  await database?.disconnect();
});

const SUITE_NAME = 'Phase 8.6 realtime outbox load and indexes';
const BACKLOG = 500;

function registerSuite(prisma: PrismaClient): void {
  describe(SUITE_NAME, () => {
    const client = createRepositoryClient(prisma);

    beforeEach(async () => {
      await resetTournamentData(prisma);
    });

    /** Inserts `count` outbox rows for `tournamentId` without the service validation. */
    async function seedBacklog(tournamentId: string, count: number): Promise<void> {
      await prisma.realtimeEvent.createMany({
        data: Array.from({ length: count }, (_, index) => ({
          tournamentId,
          eventType: 'MATCH_COMPLETED',
          aggregateType: 'MATCH',
          aggregateId: tournamentId,
          payload: {},
          // Distinct createdAt lets ordering be asserted deterministically.
          createdAt: new Date(Date.UTC(2026, 8, 27, 10, 0, 0, index)),
        })),
      });
    }

    it('reads a bounded oldest-first batch and drains the whole backlog', async () => {
      const tournament = await createTournament(prisma);
      await seedBacklog(tournament.id, BACKLOG);

      // A dispatcher batch never returns more than its limit.
      const firstBatch = await client.realtimeEvents.getPendingEvents(100);
      expect(firstBatch).toHaveLength(100);
      // Oldest first.
      const times = firstBatch.map((event) => event.occurredAt.getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      // A small batch sees the oldest slice, not an arbitrary one.
      const smallBatch = await client.realtimeEvents.getPendingEvents(5);
      expect(smallBatch.map((event) => event.id)).toEqual(
        firstBatch.slice(0, 5).map((event) => event.id),
      );

      const publisher = createRealtimeEventPublisher();
      const delivered: string[] = [];
      publisher.subscribe(tournament.id, {
        send: (event) => {
          delivered.push(event.id);
        },
      });

      const dispatcher = createRealtimeDispatcher({
        repository: client.realtimeEvents,
        publisher,
        batchSize: 100,
      });

      // Drain repeatedly, as the poll loop would, until nothing is pending.
      let total = 0;
      for (let guard = 0; guard < 50; guard += 1) {
        const published = await dispatcher.drain();
        total += published;
        if (published === 0) {
          break;
        }
      }

      expect(total).toBe(BACKLOG);
      expect(delivered).toHaveLength(BACKLOG);
      expect(await client.realtimeEvents.getPendingEvents(10)).toHaveLength(0);
    });

    it('preserves tournament isolation under volume', async () => {
      const tournamentA = await createTournament(prisma, { name: 'Load A' });
      const tournamentB = await createTournament(prisma, { name: 'Load B' });
      await seedBacklog(tournamentA.id, 200);
      await seedBacklog(tournamentB.id, 200);

      const publisher = createRealtimeEventPublisher();
      let countA = 0;
      let countB = 0;
      publisher.subscribe(tournamentA.id, {
        send: () => {
          countA += 1;
        },
      });
      publisher.subscribe(tournamentB.id, {
        send: () => {
          countB += 1;
        },
      });

      const dispatcher = createRealtimeDispatcher({
        repository: client.realtimeEvents,
        publisher,
        batchSize: 100,
      });
      for (let guard = 0; guard < 20; guard += 1) {
        if ((await dispatcher.drain()) === 0) {
          break;
        }
      }

      expect(countA).toBe(200);
      expect(countB).toBe(200);
    });

    it('does not lose rows when two dispatchers drain concurrently', async () => {
      const tournament = await createTournament(prisma);
      await seedBacklog(tournament.id, BACKLOG);

      const publisher = createRealtimeEventPublisher();
      const delivered = new Set<string>();
      publisher.subscribe(tournament.id, {
        send: (event) => {
          delivered.add(event.id);
        },
      });

      const dispatcherA = createRealtimeDispatcher({
        repository: client.realtimeEvents,
        publisher,
        batchSize: 100,
      });
      const dispatcherB = createRealtimeDispatcher({
        repository: client.realtimeEvents,
        publisher,
        batchSize: 100,
      });

      for (let guard = 0; guard < 30; guard += 1) {
        const [a, b] = await Promise.all([dispatcherA.drain(), dispatcherB.drain()]);
        if (a === 0 && b === 0) {
          break;
        }
      }

      // At-least-once: every row is delivered at least once, none is lost, and
      // the outbox is fully published even with two concurrent drains.
      expect(delivered.size).toBe(BACKLOG);
      expect(await client.realtimeEvents.getPendingEvents(10)).toHaveLength(0);
    });

    it('keeps the documented realtime_events indexes present', async () => {
      const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'realtime_events'
      `;
      const names = rows.map((row) => row.indexname);
      expect(names).toContain('realtime_events_tournamentId_createdAt_idx');
      expect(names).toContain('realtime_events_publishedAt_idx');
    });
  });
}

if (database) {
  registerSuite(database.prisma);
} else {
  describe.skip(SUITE_NAME, () => {});
}
