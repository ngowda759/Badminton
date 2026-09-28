import {
  createRealtimeDispatcher,
  createRealtimeEventPublisher,
  createRealtimeEventService,
  type RealtimeDispatcherScheduler,
  type RealtimeEventPublisher,
  type RepositoryClient,
} from '@badminton/application';
import type { RealtimeEvent } from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import { seedTournament } from './fixtures.ts';

/**
 * Phase 8.6 application hardening tests.
 *
 * They pin the durability properties the multi-device story depends on, without
 * a database:
 *
 * - the NOTIFY wake-up is a latency optimisation, never durable transport: a
 *   *missed* wake-up still results in the pending outbox row being processed by
 *   the polling tick;
 * - the dispatcher recovers a pending backlog on start (a restart);
 * - a durable row is retried after a failed publish rather than lost;
 * - two subscribers of the same tournament both receive every event, so a burst
 *   cannot silently drop one client.
 */

let repos: FakeRepositories;
const eventService = createRealtimeEventService();

beforeEach(() => {
  repos = createFakeRepositories();
});

async function record(
  client: RepositoryClient,
  tournamentId: string,
  aggregateId: string,
  eventType: RealtimeEvent['eventType'] = 'MATCH_COMPLETED',
): Promise<RealtimeEvent> {
  return eventService.record(client, {
    tournamentId,
    eventType,
    aggregateType: 'MATCH',
    aggregateId,
  });
}

/** A scheduler whose ticks only fire when the test asks for them. */
class ManualScheduler {
  private pending: Array<() => void> = [];
  /** How many timers have been scheduled in total (across cancel/reschedule). */
  scheduled = 0;

  readonly scheduler: RealtimeDispatcherScheduler = {
    setTimer: (callback) => {
      this.pending.push(callback);
      this.scheduled += 1;
      return {
        cancel: () => {
          this.pending = this.pending.filter((entry) => entry !== callback);
        },
      };
    },
  };

  /** Runs every scheduled callback and lets the triggered promises settle. */
  async flush(): Promise<void> {
    const callbacks = this.pending;
    this.pending = [];
    for (const callback of callbacks) {
      callback();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('Phase 8.6 dispatcher durability', () => {
  it('processes a pending row on a poll tick even when no NOTIFY wake-up arrives', async () => {
    const tournamentId = await seedTournament(repos.client);
    const publisher = createRealtimeEventPublisher();
    const received: RealtimeEvent[] = [];
    publisher.subscribe(tournamentId, {
      send: (event) => {
        received.push(event);
      },
    });

    const scheduler = new ManualScheduler();
    const dispatcher = createRealtimeDispatcher({
      repository: repos.client.realtimeEvents,
      publisher,
      scheduler: scheduler.scheduler,
    });

    // `start()` drains once. Let that settle with an empty outbox.
    dispatcher.start();
    await scheduler.flush();
    expect(received).toHaveLength(0);

    // The insert happens but the NOTIFY is lost: `wake()` is never called.
    await record(repos.client, tournamentId, tournamentId);

    // The next polling tick must still find and publish the durable row.
    await scheduler.flush();
    await dispatcher.stop();

    expect(received).toHaveLength(1);
  });

  it('recovers a multi-event backlog on start, oldest first', async () => {
    const tournamentId = await seedTournament(repos.client);
    // Committed while no dispatcher was running, as after a process restart.
    await record(repos.client, tournamentId, tournamentId, 'MATCH_SCHEDULED');
    await record(repos.client, tournamentId, tournamentId, 'MATCH_STARTED');
    await record(repos.client, tournamentId, tournamentId, 'MATCH_COMPLETED');

    const publisher = createRealtimeEventPublisher();
    const received: RealtimeEvent[] = [];
    publisher.subscribe(tournamentId, {
      send: (event) => {
        received.push(event);
      },
    });

    const scheduler = new ManualScheduler();
    const dispatcher = createRealtimeDispatcher({
      repository: repos.client.realtimeEvents,
      publisher,
      scheduler: scheduler.scheduler,
    });
    dispatcher.start();
    await scheduler.flush();
    await dispatcher.stop();

    expect(received.map((event) => event.eventType)).toEqual([
      'MATCH_SCHEDULED',
      'MATCH_STARTED',
      'MATCH_COMPLETED',
    ]);
    expect(await repos.client.realtimeEvents.getPendingEvents(10)).toHaveLength(0);
  });

  it('keeps a durable row pending after a failed publish and retries it', async () => {
    const tournamentId = await seedTournament(repos.client);
    const errors: unknown[] = [];
    let failNext = true;

    const realPublisher = createRealtimeEventPublisher();
    const received: RealtimeEvent[] = [];
    realPublisher.subscribe(tournamentId, {
      send: (event) => {
        received.push(event);
      },
    });
    const publisher: RealtimeEventPublisher = {
      // Fail the first delivery at the publisher boundary (the dispatcher's
      // catch is for a publisher-level failure; the publisher isolates sinks).
      publish: async (event) => {
        if (failNext) {
          failNext = false;
          throw new Error('publisher temporarily unavailable');
        }
        await realPublisher.publish(event);
      },
      subscribe: (tournamentId, sink) => realPublisher.subscribe(tournamentId, sink),
      tournaments: () => realPublisher.tournaments(),
    };

    await record(repos.client, tournamentId, tournamentId);

    const scheduler = new ManualScheduler();
    const dispatcher = createRealtimeDispatcher({
      repository: repos.client.realtimeEvents,
      publisher,
      scheduler: scheduler.scheduler,
      onError: (error) => errors.push(error),
    });
    dispatcher.start();
    await scheduler.flush();

    expect(errors).toHaveLength(1);
    expect(received).toHaveLength(0);
    // The row survived the failure, so it is still in the pending set.
    expect(await repos.client.realtimeEvents.getPendingEvents(10)).toHaveLength(1);

    // The next tick retries and delivers it.
    await scheduler.flush();
    await dispatcher.stop();

    expect(received).toHaveLength(1);
    expect(await repos.client.realtimeEvents.getPendingEvents(10)).toHaveLength(0);
  });

  it('never re-publishes an already published row on a later drain', async () => {
    const tournamentId = await seedTournament(repos.client);
    const publisher = createRealtimeEventPublisher();
    const received: RealtimeEvent[] = [];
    publisher.subscribe(tournamentId, {
      send: (event) => {
        received.push(event);
      },
    });

    await record(repos.client, tournamentId, tournamentId);
    const dispatcher = createRealtimeDispatcher({
      repository: repos.client.realtimeEvents,
      publisher,
    });

    expect(await dispatcher.drain()).toBe(1);
    // A second drain finds nothing pending: publishing is not duplicated.
    expect(await dispatcher.drain()).toBe(0);
    expect(received).toHaveLength(1);
  });

  it('wakes on a NOTIFY signal without waiting for the poll cadence', async () => {
    const tournamentId = await seedTournament(repos.client);
    const publisher = createRealtimeEventPublisher();
    const received: RealtimeEvent[] = [];
    publisher.subscribe(tournamentId, {
      send: (event) => {
        received.push(event);
      },
    });

    const scheduler = new ManualScheduler();
    const dispatcher = createRealtimeDispatcher({
      repository: repos.client.realtimeEvents,
      publisher,
      scheduler: scheduler.scheduler,
    });
    dispatcher.start();
    await scheduler.flush();

    await record(repos.client, tournamentId, tournamentId);
    dispatcher.wake();
    await scheduler.flush();
    await dispatcher.stop();

    expect(received).toHaveLength(1);
  });
});

describe('Phase 8.6 concurrent multi-subscriber delivery', () => {
  it('delivers every event of a burst to all subscribers of the tournament', async () => {
    const tournamentId = await seedTournament(repos.client);
    const publisher = createRealtimeEventPublisher();
    const clientA: RealtimeEvent[] = [];
    const clientB: RealtimeEvent[] = [];
    publisher.subscribe(tournamentId, {
      send: (event) => {
        clientA.push(event);
      },
    });
    publisher.subscribe(tournamentId, {
      send: (event) => {
        clientB.push(event);
      },
    });

    for (const type of [
      'MATCH_COMPLETED',
      'MATCH_COMPLETED',
      'MATCH_SCHEDULED',
      'COURT_STATUS_CHANGED',
    ] as const) {
      await record(repos.client, tournamentId, tournamentId, type);
    }

    const dispatcher = createRealtimeDispatcher({
      repository: repos.client.realtimeEvents,
      publisher,
    });
    expect(await dispatcher.drain()).toBe(4);

    expect(clientA).toHaveLength(4);
    expect(clientB).toHaveLength(4);
    expect(clientA.map((event) => event.id)).toEqual(clientB.map((event) => event.id));
  });

  it('publishes event ordering faithfully (delivery order is not client state)', async () => {
    const tournamentId = await seedTournament(repos.client);
    const publisher = createRealtimeEventPublisher();
    const received: RealtimeEvent[] = [];
    publisher.subscribe(tournamentId, {
      send: (event) => {
        received.push(event);
      },
    });

    const first = await record(repos.client, tournamentId, tournamentId, 'MATCH_SCHEDULED');
    const second = await record(repos.client, tournamentId, tournamentId, 'MATCH_STARTED');
    const third = await record(repos.client, tournamentId, tournamentId, 'MATCH_COMPLETED');

    const dispatcher = createRealtimeDispatcher({
      repository: repos.client.realtimeEvents,
      publisher,
    });
    await dispatcher.drain();

    // The dispatcher forwards in commit order; clients still converge on REST,
    // so an out-of-order redelivery could not corrupt state (see Phase 8.6 web
    // tests, which only ever refetch REST).
    expect(received.map((event) => event.id)).toEqual([first.id, second.id, third.id]);
  });
});
