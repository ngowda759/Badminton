import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { RealtimeEventSource } from './realtime-client.ts';
import type { RealtimeEvent } from './realtime-types.ts';
import { useTournamentRealtime } from './use-tournament-realtime.ts';

const TOURNAMENT_A = '11111111-1111-4111-8111-111111111111';
const TOURNAMENT_B = '22222222-2222-4222-8222-222222222222';

const EVENT_DATA = JSON.stringify({
  id: 'event-id',
  event: 'MATCH_COMPLETED',
  tournamentId: TOURNAMENT_A,
  aggregateType: 'MATCH',
  aggregateId: 'match-id',
  occurredAt: '2026-09-28T10:00:00.000Z',
  payload: {},
});

/** A hand-driven fake `EventSource`, one instance per factory call. */
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

  public error(): void {
    this.readyState = 1;
    this.onerror?.(new Event('error'));
  }

  public message(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

interface Harness {
  readonly sources: FakeEventSource[];
  readonly factory: (url: string) => FakeEventSource;
  /** The sources that have not been closed. */
  readonly active: () => FakeEventSource[];
}

function createHarness(): Harness {
  const sources: FakeEventSource[] = [];
  const factory = (url: string): FakeEventSource => {
    const source = new FakeEventSource(url);
    sources.push(source);
    return source;
  };
  return { sources, factory, active: () => sources.filter((source) => source.closeCalls === 0) };
}

interface ProbeProps {
  readonly id: string;
  readonly factory: (url: string) => FakeEventSource;
  readonly onEvent?: (event: RealtimeEvent) => void;
}

/** Renders the hook and exposes its state to the test through the DOM. */
function Probe({ id, factory, onEvent }: ProbeProps) {
  const { status, lastEvent } = useTournamentRealtime(id, {
    ...(onEvent ? { onEvent } : {}),
    eventSourceFactory: factory,
  });
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="event">{lastEvent?.event ?? 'none'}</span>
    </div>
  );
}

describe('useTournamentRealtime', () => {
  it('opens one connection and closes it on unmount', () => {
    const { sources, factory, active } = createHarness();
    const { getByTestId, unmount } = render(<Probe id={TOURNAMENT_A} factory={factory} />);

    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toContain(`/api/v1/tournaments/${TOURNAMENT_A}/events`);

    act(() => {
      sources[0]?.open();
    });
    expect(getByTestId('status')).toHaveTextContent('CONNECTED');

    unmount();
    expect(sources[0]?.closeCalls).toBe(1);
    expect(active()).toHaveLength(0);
  });

  it('delivers a parsed event to the consumer and to lastEvent', () => {
    const onEvent = vi.fn();
    const { sources, factory } = createHarness();
    const { getByTestId } = render(<Probe id={TOURNAMENT_A} factory={factory} onEvent={onEvent} />);
    act(() => {
      sources[0]?.open();
    });

    act(() => {
      sources[0]?.message(EVENT_DATA);
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({ event: 'MATCH_COMPLETED' });
    expect(getByTestId('event')).toHaveTextContent('MATCH_COMPLETED');
  });

  it('ignores a malformed event and keeps the connection open', () => {
    const onEvent = vi.fn();
    const { sources, factory } = createHarness();
    const { getByTestId } = render(<Probe id={TOURNAMENT_A} factory={factory} onEvent={onEvent} />);
    act(() => {
      sources[0]?.open();
    });

    act(() => {
      sources[0]?.message('not json');
      sources[0]?.message(JSON.stringify({ id: 'x' }));
    });

    expect(onEvent).not.toHaveBeenCalled();
    expect(getByTestId('status')).toHaveTextContent('CONNECTED');
  });

  it('does not invoke callbacks after unmount', () => {
    const onEvent = vi.fn();
    const { sources, factory } = createHarness();
    const { unmount } = render(<Probe id={TOURNAMENT_A} factory={factory} onEvent={onEvent} />);
    act(() => {
      sources[0]?.open();
    });
    const source = sources[0];

    unmount();

    act(() => {
      source?.open();
      source?.error();
      source?.message(EVENT_DATA);
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('closes A and opens B when the tournament id changes, leaving only B active', () => {
    const { sources, factory, active } = createHarness();
    const { rerender } = render(<Probe id={TOURNAMENT_A} factory={factory} />);

    rerender(<Probe id={TOURNAMENT_B} factory={factory} />);

    expect(sources).toHaveLength(2);
    expect(sources[0]?.closeCalls).toBe(1);
    expect(sources[1]?.url).toContain(`/api/v1/tournaments/${TOURNAMENT_B}/events`);
    expect(active()).toHaveLength(1);
    expect(active()[0]).toBe(sources[1]);
  });

  it('does not open a connection for an absent or malformed tournament id', () => {
    const { sources, factory } = createHarness();
    const { getByTestId } = render(<Probe id="not-a-uuid" factory={factory} />);

    expect(sources).toHaveLength(0);
    expect(getByTestId('status')).toHaveTextContent('DISCONNECTED');
  });

  it('keeps one active connection across rerenders', () => {
    const { factory, active } = createHarness();
    const { rerender } = render(<Probe id={TOURNAMENT_A} factory={factory} />);

    rerender(<Probe id={TOURNAMENT_A} factory={factory} />);
    rerender(<Probe id={TOURNAMENT_A} factory={factory} />);

    expect(active()).toHaveLength(1);
  });

  it('opens exactly one active connection under React Strict Mode', () => {
    const { factory, active } = createHarness();

    render(
      <StrictMode>
        <Probe id={TOURNAMENT_A} factory={factory} />
      </StrictMode>,
    );

    expect(active()).toHaveLength(1);
  });
});
