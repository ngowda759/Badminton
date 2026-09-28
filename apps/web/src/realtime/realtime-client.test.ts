import { describe, expect, it, vi } from 'vitest';

import {
  buildTournamentEventsUrl,
  createTournamentRealtimeClient,
  type RealtimeEventSource,
} from './realtime-client.ts';
import type { RealtimeConnectionStatus, RealtimeEvent } from './realtime-types.ts';

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';

/** A hand-driven fake of the native `EventSource`, one instance per call. */
class FakeEventSource implements RealtimeEventSource {
  public readyState = 0;
  public onopen: ((event: Event) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public closeCalls = 0;

  public constructor(public readonly url: string) {}

  public close(): void {
    this.closeCalls += 1;
    this.readyState = 2;
  }

  public open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  public error(readyState = 1): void {
    this.readyState = readyState;
    this.onerror?.(new Event('error'));
  }

  /** Emits an SSE message; `data` is the raw `data:` field content. */
  public message(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

function setup() {
  const sources: FakeEventSource[] = [];
  const statuses: RealtimeConnectionStatus[] = [];
  const events: RealtimeEvent[] = [];

  const client = createTournamentRealtimeClient({
    url: buildTournamentEventsUrl('http://api.test', TOURNAMENT_ID),
    onStatus: (status) => {
      statuses.push(status);
    },
    onEvent: (event) => {
      events.push(event);
    },
    eventSourceFactory: (url) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
  });

  return { client, sources, statuses, events };
}

const EVENT_DATA = JSON.stringify({
  id: 'event-id',
  event: 'MATCH_COMPLETED',
  tournamentId: TOURNAMENT_ID,
  aggregateType: 'MATCH',
  aggregateId: 'match-id',
  occurredAt: '2026-09-28T10:00:00.000Z',
  payload: {},
});

describe('buildTournamentEventsUrl', () => {
  it('builds the tournament-scoped endpoint and trims a trailing slash', () => {
    expect(buildTournamentEventsUrl('http://api.test/', TOURNAMENT_ID)).toBe(
      `http://api.test/api/v1/tournaments/${TOURNAMENT_ID}/events`,
    );
  });

  it('path-encodes the tournament id', () => {
    expect(buildTournamentEventsUrl('http://api.test', 'a/b')).toBe(
      'http://api.test/api/v1/tournaments/a%2Fb/events',
    );
  });
});

describe('tournament realtime client lifecycle', () => {
  it('creates the EventSource and reports CONNECTING then CONNECTED', () => {
    const { client, sources, statuses } = setup();

    expect(client.getStatus()).toBe('DISCONNECTED');

    client.start();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toBe(`http://api.test/api/v1/tournaments/${TOURNAMENT_ID}/events`);
    expect(client.getStatus()).toBe('CONNECTING');

    sources[0]?.open();
    expect(client.getStatus()).toBe('CONNECTED');
    expect(statuses).toEqual(['CONNECTING', 'CONNECTED']);
  });

  it('reports RECONNECTING on a temporary error then CONNECTED on recovery', () => {
    const { client, sources, statuses } = setup();
    client.start();
    sources[0]?.open();

    sources[0]?.error(0);
    expect(client.getStatus()).toBe('RECONNECTING');

    sources[0]?.open();
    expect(client.getStatus()).toBe('CONNECTED');
    expect(statuses).toEqual(['CONNECTING', 'CONNECTED', 'RECONNECTING', 'CONNECTED']);
  });

  it('reports DISCONNECTED when the source gives up (readyState CLOSED)', () => {
    const { client, sources } = setup();
    client.start();
    sources[0]?.open();

    sources[0]?.error(2);
    expect(client.getStatus()).toBe('DISCONNECTED');
  });

  it('closes the source and reports DISCONNECTED on stop', () => {
    const { client, sources, statuses } = setup();
    client.start();
    sources[0]?.open();

    client.stop();
    expect(sources[0]?.closeCalls).toBe(1);
    expect(client.getStatus()).toBe('DISCONNECTED');
    expect(statuses.at(-1)).toBe('DISCONNECTED');
  });

  it('is idempotent: a second start does not open another connection', () => {
    const { client, sources } = setup();

    client.start();
    client.start();
    client.start();

    expect(sources).toHaveLength(1);
  });

  it('does not reconnect after stop', () => {
    const { client, sources } = setup();
    client.start();
    client.stop();

    client.start();
    expect(sources).toHaveLength(1);
  });

  it('never invokes callbacks after disposal', () => {
    const { client, sources, statuses, events } = setup();
    client.start();
    const source = sources[0];
    source?.open();
    client.stop();

    const statusCount = statuses.length;
    source?.open();
    source?.error(0);
    source?.message(EVENT_DATA);

    expect(statuses).toHaveLength(statusCount);
    expect(events).toHaveLength(0);
  });

  it('does not crash when the EventSource constructor throws', () => {
    const statuses: RealtimeConnectionStatus[] = [];
    const client = createTournamentRealtimeClient({
      url: 'http://api.test/api/v1/tournaments/x/events',
      onStatus: (status) => {
        statuses.push(status);
      },
      eventSourceFactory: () => {
        throw new Error('bad url');
      },
    });

    expect(() => {
      client.start();
    }).not.toThrow();
    expect(client.getStatus()).toBe('DISCONNECTED');
    expect(statuses).toEqual(['CONNECTING', 'DISCONNECTED']);
  });
});

describe('tournament realtime client event handling', () => {
  it('delivers a well-formed event to the consumer', () => {
    const { client, sources, events } = setup();
    client.start();
    sources[0]?.open();

    sources[0]?.message(EVENT_DATA);

    expect(events).toEqual([
      {
        id: 'event-id',
        event: 'MATCH_COMPLETED',
        tournamentId: TOURNAMENT_ID,
        aggregateType: 'MATCH',
        aggregateId: 'match-id',
        occurredAt: '2026-09-28T10:00:00.000Z',
        payload: {},
      },
    ]);
  });

  it('delivers an unknown event type when the envelope is valid', () => {
    const { client, sources, events } = setup();
    client.start();
    sources[0]?.open();

    sources[0]?.message(JSON.stringify({ ...JSON.parse(EVENT_DATA), event: 'FUTURE_EVENT' }));

    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('FUTURE_EVENT');
  });

  it('ignores malformed data and keeps the connection usable', () => {
    const { client, sources, events, statuses } = setup();
    client.start();
    sources[0]?.open();

    sources[0]?.message('not json');
    sources[0]?.message(JSON.stringify({ id: 'x' }));
    sources[0]?.message(JSON.stringify({ ...JSON.parse(EVENT_DATA), event: '' }));
    sources[0]?.message(42);
    sources[0]?.message(new Uint8Array([1, 2, 3]));

    expect(events).toHaveLength(0);
    expect(client.getStatus()).toBe('CONNECTED');

    sources[0]?.message(EVENT_DATA);
    expect(events).toHaveLength(1);
    expect(statuses).toEqual(['CONNECTING', 'CONNECTED']);
  });
});

describe('no REST coupling', () => {
  it('does not fetch or call any other endpoint when an event arrives', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { client, sources } = setup();
    client.start();
    sources[0]?.open();

    sources[0]?.message(EVENT_DATA);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
