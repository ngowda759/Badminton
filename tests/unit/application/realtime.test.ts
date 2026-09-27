import {
  createRealtimeDispatcher,
  createRealtimeEventPublisher,
  createRealtimeEventService,
  type RealtimeDispatcherScheduler,
  type RepositoryClient,
} from '@badminton/application';
import type { RealtimeEvent } from '@badminton/domain';
import { RealtimeEventValidationError } from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import { seedTournament } from './fixtures.ts';

/**
 * Phase 8.1 application tests.
 *
 * They exercise the real event service, publisher and dispatcher over the
 * in-memory repositories: transactional outbox semantics (business change and
 * event commit together, a rollback writes nothing), multi-event transactions,
 * tournament-scoped delivery and dispatcher recovery after a failed publish.
 */

let repos: FakeRepositories;
const eventService = createRealtimeEventService();

beforeEach(() => {
  repos = createFakeRepositories();
});

async function recordMatchEvent(
  client: RepositoryClient,
  tournamentId: string,
  matchId: string,
  eventType: RealtimeEvent['eventType'] = 'MATCH_COMPLETED',
) {
  return eventService.record(client, {
    tournamentId,
    eventType,
    aggregateType: 'MATCH',
    aggregateId: matchId,
  });
}

describe('RealtimeEventService', () => {
  it('persists a well-formed event with null payload', async () => {
    const tournamentId = await seedTournament(repos.client);
    const event = await recordMatchEvent(repos.client, tournamentId, tournamentId);

    expect(event.eventType).toBe('MATCH_COMPLETED');
    expect(event.payload).toBeNull();
    expect(event.publishedAt).toBeNull();
  });

  it('normalises a small payload', async () => {
    const tournamentId = await seedTournament(repos.client);
    const event = await eventService.record(repos.client, {
      tournamentId,
      eventType: 'COURT_UPDATED',
      aggregateType: 'COURT',
      aggregateId: tournamentId,
      payload: { number: 1 },
    });
    expect(event.payload).toEqual({ number: 1 });
  });

  it('rejects an unknown event or aggregate type', async () => {
    const tournamentId = await seedTournament(repos.client);
    await expect(
      eventService.record(repos.client, {
        tournamentId,
        // Deliberately outside the catalogue.
        eventType: 'MATCH_EXPLODED' as RealtimeEvent['eventType'],
        aggregateType: 'MATCH',
        aggregateId: tournamentId,
      }),
    ).rejects.toBeInstanceOf(RealtimeEventValidationError);

    await expect(
      eventService.record(repos.client, {
        tournamentId,
        eventType: 'MATCH_COMPLETED',
        aggregateType: 'PLAYER' as RealtimeEvent['aggregateType'],
        aggregateId: tournamentId,
      }),
    ).rejects.toBeInstanceOf(RealtimeEventValidationError);
  });
});

describe('transactional outbox', () => {
  it('commits the business change and its event in one transaction', async () => {
    const tournamentId = await seedTournament(repos.client);

    await repos.unitOfWork.runInTransaction(async (tx) => {
      await recordMatchEvent(tx, tournamentId, tournamentId, 'MATCH_STARTED');
    });

    const pending = await repos.client.realtimeEvents.getPendingEvents(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.eventType).toBe('MATCH_STARTED');
  });

  it('rolls the event back with the business change', async () => {
    const tournamentId = await seedTournament(repos.client);

    await expect(
      repos.unitOfWork.runInTransaction(async (tx) => {
        await recordMatchEvent(tx, tournamentId, tournamentId, 'MATCH_COMPLETED');
        throw new Error('business change rejected');
      }),
    ).rejects.toThrow('business change rejected');

    expect(await repos.client.realtimeEvents.getPendingEvents(10)).toHaveLength(0);
  });

  it('commits multiple events from one transaction atomically', async () => {
    const tournamentId = await seedTournament(repos.client);

    await repos.unitOfWork.runInTransaction(async (tx) => {
      await recordMatchEvent(tx, tournamentId, tournamentId, 'MATCH_COMPLETED');
      await recordMatchEvent(tx, tournamentId, tournamentId, 'KNOCKOUT_MATCH_POPULATED');
    });

    const pending = await repos.client.realtimeEvents.getPendingEvents(10);
    expect(pending.map((event) => event.eventType)).toEqual([
      'MATCH_COMPLETED',
      'KNOCKOUT_MATCH_POPULATED',
    ]);
  });

  it('does not persist an event from an invalid transaction', async () => {
    const tournamentId = await seedTournament(repos.client);

    await expect(
      repos.unitOfWork.runInTransaction(async (tx) => {
        await eventService.record(tx, {
          tournamentId,
          eventType: 'NOPE' as RealtimeEvent['eventType'],
          aggregateType: 'MATCH',
          aggregateId: tournamentId,
        });
      }),
    ).rejects.toBeInstanceOf(RealtimeEventValidationError);

    expect(await repos.client.realtimeEvents.getPendingEvents(10)).toHaveLength(0);
  });
});

describe('RealtimeEventPublisher', () => {
  it('delivers an event only to subscribers of its tournament', async () => {
    const publisher = createRealtimeEventPublisher();
    const tournamentA = await seedTournament(repos.client, { name: 'A' });
    const tournamentB = await seedTournament(repos.client, { name: 'B' });

    const receivedA: RealtimeEvent[] = [];
    const receivedB: RealtimeEvent[] = [];
    publisher.subscribe(tournamentA, {
      send: (event) => {
        receivedA.push(event);
      },
    });
    publisher.subscribe(tournamentB, {
      send: (event) => {
        receivedB.push(event);
      },
    });

    const event = await recordMatchEvent(repos.client, tournamentA, tournamentA);
    await publisher.publish(event);

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(0);
  });

  it('unsubscribes cleanly and tolerates having no subscribers', async () => {
    const publisher = createRealtimeEventPublisher();
    const tournamentId = await seedTournament(repos.client);
    const received: RealtimeEvent[] = [];
    const unsubscribe = publisher.subscribe(tournamentId, {
      send: (e) => {
        received.push(e);
      },
    });

    unsubscribe();
    expect(publisher.tournaments()).toEqual([]);

    const event = await recordMatchEvent(repos.client, tournamentId, tournamentId);
    await expect(publisher.publish(event)).resolves.toBeUndefined();
    expect(received).toHaveLength(0);
  });

  it('isolates a failing sink from the others', async () => {
    const errors: unknown[] = [];
    const publisher = createRealtimeEventPublisher({
      onSinkError: (error) => errors.push(error),
    });
    const tournamentId = await seedTournament(repos.client);
    const received: RealtimeEvent[] = [];
    publisher.subscribe(tournamentId, {
      send: () => {
        throw new Error('connection reset');
      },
    });
    publisher.subscribe(tournamentId, {
      send: (event) => {
        received.push(event);
      },
    });

    const event = await recordMatchEvent(repos.client, tournamentId, tournamentId);
    await publisher.publish(event);

    expect(received).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});

describe('RealtimeDispatcher', () => {
  it('drains pending events and marks them published', async () => {
    const tournamentId = await seedTournament(repos.client);
    const publisher = createRealtimeEventPublisher();
    const received: RealtimeEvent[] = [];
    publisher.subscribe(tournamentId, {
      send: (event) => {
        received.push(event);
      },
    });

    const event = await recordMatchEvent(repos.client, tournamentId, tournamentId);
    const dispatcher = createRealtimeDispatcher({
      repository: repos.client.realtimeEvents,
      publisher,
    });

    const published = await dispatcher.drain();
    expect(published).toBe(1);
    expect(received.map((e) => e.id)).toEqual([event.id]);
    expect(await repos.client.realtimeEvents.getPendingEvents(10)).toHaveLength(0);
  });

  it('leaves an event pending when publication fails', async () => {
    const tournamentId = await seedTournament(repos.client);
    const errors: unknown[] = [];
    let fail = true;
    const publisher = createRealtimeEventPublisher();
    publisher.subscribe(tournamentId, {
      send: () => {
        if (fail) {
          throw new Error('sink unavailable');
        }
      },
    });

    // The publisher swallows a sink failure, so simulate a publisher-level
    // failure by overriding publish on a wrapper.
    const failingPublisher = {
      ...publisher,
      publish: async (event: RealtimeEvent) => {
        if (fail) {
          throw new Error('publisher unavailable');
        }
        await publisher.publish(event);
      },
    };

    await recordMatchEvent(repos.client, tournamentId, tournamentId);
    const dispatcher = createRealtimeDispatcher({
      repository: repos.client.realtimeEvents,
      publisher: failingPublisher,
      onError: (error) => errors.push(error),
    });

    expect(await dispatcher.drain()).toBe(0);
    expect(errors).toHaveLength(1);
    // The durable row is still pending, so the next drain recovers it.
    expect(await repos.client.realtimeEvents.getPendingEvents(10)).toHaveLength(1);

    fail = false;
    expect(await dispatcher.drain()).toBe(1);
    expect(await repos.client.realtimeEvents.getPendingEvents(10)).toHaveLength(0);
  });

  it('recovers pending events on start, including after a restart', async () => {
    const tournamentId = await seedTournament(repos.client);
    // An event committed before the dispatcher existed, as after a process
    // restart would find.
    await recordMatchEvent(repos.client, tournamentId, tournamentId);

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

    expect(received).toHaveLength(1);
  });

  it('wakes on demand from a notifier signal', async () => {
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

    await recordMatchEvent(repos.client, tournamentId, tournamentId);
    dispatcher.wake();
    await scheduler.flush();
    await dispatcher.stop();

    expect(received).toHaveLength(1);
  });
});

/** A scheduler whose ticks only happen when the test asks for them. */
class ManualScheduler {
  private pending: Array<() => void> = [];

  readonly scheduler: RealtimeDispatcherScheduler = {
    setTimer: (callback) => {
      this.pending.push(callback);
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
