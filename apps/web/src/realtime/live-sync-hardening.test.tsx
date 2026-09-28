import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '@/api/context.tsx';
import type { TournamentDashboardDto } from '@/api/types.ts';
import { CategoryProvider, TournamentProvider } from '@/components/tournaments/context.tsx';
import type { RealtimeEventSource } from '@/realtime/realtime-client.ts';
import { TournamentRealtimeProvider } from '@/realtime/tournament-refresh.tsx';
import { TournamentDashboardPage } from '@/pages/tournaments/dashboard.tsx';

import {
  createStubApi,
  makeCategory,
  makeDashboard,
  makeTournament,
} from '../../tests/helpers.tsx';

/**
 * Phase 8.6 web hardening tests.
 *
 * Phase 8.5 already proves a single event refreshes a screen. These tests pin
 * the multi-device/failure behavior the Phase 8.6 acceptance criteria call for,
 * over the real provider, the real REST query hook and a hand-driven
 * `EventSource`:
 *
 * - event bursts cause a bounded number of REST requests (no request storm);
 * - duplicate/out-of-order events stay idempotent (REST is the source of truth);
 * - a reconnect after a lost connection refetches authoritative state, covering
 *   missed events;
 * - rapid disconnect/reconnect cycles do not storm;
 * - a failed realtime-triggered refetch uses existing error handling and the
 *   stream keeps working, so a later event can refresh again;
 * - realtime being entirely unavailable leaves REST and manual refresh working;
 * - unmount cancels a pending flush and closes the stream.
 */

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TOURNAMENT_ID = '99999999-9999-4999-8999-999999999999';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const MATCH_ID = '88888888-8888-4888-8888-888888888888';

const TOURNAMENT = makeTournament({ id: TOURNAMENT_ID });
const CATEGORY = makeCategory({ id: CATEGORY_ID, tournamentId: TOURNAMENT_ID });

/** Hand-driven fake `EventSource`; one instance per factory call. */
class FakeEventSource implements RealtimeEventSource {
  public readyState = 0;
  public onopen: ((event: Event) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public closeCalls = 0;
  private readonly named = new Map<string, Set<(event: MessageEvent) => void>>();

  public constructor(public readonly url: string) {}

  public addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const set = this.named.get(type) ?? new Set();
    set.add(listener);
    this.named.set(type, set);
  }

  public removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.named.get(type)?.delete(listener);
  }

  public close(): void {
    this.closeCalls += 1;
    this.readyState = 2;
  }

  public open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  public reconnect(): void {
    this.readyState = 1;
    this.onerror?.(new Event('error'));
  }

  /** Emits a named event frame exactly as the server frames it. */
  public message(event: string, tournamentId = TOURNAMENT_ID): void {
    const data = JSON.stringify({
      id: `event-${tournamentId}-${event}-${String(this.closeCalls)}`,
      event,
      tournamentId,
      aggregateType: 'MATCH',
      aggregateId: MATCH_ID,
      occurredAt: '2026-09-28T10:00:00.000Z',
      payload: {},
    });
    for (const listener of this.named.get(event) ?? []) {
      listener(new MessageEvent(event, { data }));
    }
  }
}

interface Harness {
  readonly sources: FakeEventSource[];
  readonly factory: (url: string) => FakeEventSource;
}

function createHarness(): Harness {
  const sources: FakeEventSource[] = [];
  const factory = (url: string): FakeEventSource => {
    const source = new FakeEventSource(url);
    sources.push(source);
    return source;
  };
  return { sources, factory };
}

type StubApi = ReturnType<typeof createStubApi>;

interface LiveOptions {
  readonly api: StubApi;
  readonly factory: (url: string) => FakeEventSource;
  readonly tournamentId?: string;
  readonly coalesceMs?: number;
}

/** Renders the dashboard inside the real providers plus the realtime provider. */
function renderLive(ui: React.ReactNode, options: LiveOptions) {
  const tournamentId = options.tournamentId ?? TOURNAMENT_ID;
  return render(
    <ApiProvider api={options.api}>
      <MemoryRouter>
        <TournamentProvider value={{ tournament: TOURNAMENT, refetch: vi.fn() }}>
          <CategoryProvider
            value={{ category: CATEGORY, tournament: TOURNAMENT, refetch: vi.fn() }}
          >
            <TournamentRealtimeProvider
              tournamentId={tournamentId}
              eventSourceFactory={options.factory}
              refreshCoalesceMs={options.coalesceMs ?? 0}
            >
              {ui}
            </TournamentRealtimeProvider>
          </CategoryProvider>
        </TournamentProvider>
      </MemoryRouter>
    </ApiProvider>,
  );
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 120));
}

describe('Phase 8.6 request-storm protection', () => {
  it('coalesces a large event burst into one refetch', async () => {
    const api = createStubApi();
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory, coalesceMs: 40 });

    await screen.findByText('Live matches');
    act(() => {
      sources[0]?.open();
    });
    expect(api.dashboard.get).toHaveBeenCalledTimes(1);

    // A sustained burst of many events, as several courts/matches changing at once.
    act(() => {
      for (let index = 0; index < 50; index += 1) {
        sources[0]?.message('MATCH_COMPLETED');
      }
    });

    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(2);
    });
    // No further requests after the coalesced flush.
    await settle();
    expect(api.dashboard.get).toHaveBeenCalledTimes(2);
  });

  it('bounds latency and refetches again when a new burst starts later', async () => {
    const api = createStubApi();
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory, coalesceMs: 40 });
    await screen.findByText('Live matches');
    act(() => {
      sources[0]?.open();
    });

    act(() => {
      sources[0]?.message('MATCH_COMPLETED');
      sources[0]?.message('COURT_STATUS_CHANGED');
    });
    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(2);
    });

    act(() => {
      sources[0]?.message('MATCH_COMPLETED');
    });
    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(3);
    });
  });
});

describe('Phase 8.6 duplicate and ordering tolerance', () => {
  it('treats a duplicate event as idempotent: one refetch, same authoritative state', async () => {
    const api = createStubApi();
    const dashboard = makeDashboard({
      summary: { ...makeDashboard().summary, completedMatches: 7 },
    });
    vi.mocked(api.dashboard.get).mockResolvedValue(dashboard);
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory, coalesceMs: 30 });
    expect(await screen.findByText('7')).toBeInTheDocument();
    act(() => {
      sources[0]?.open();
    });

    // At-least-once delivery: the same event twice, as a retry would produce.
    act(() => {
      sources[0]?.message('MATCH_COMPLETED');
      sources[0]?.message('MATCH_COMPLETED');
    });

    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(2);
    });
    // REST still returns the same authoritative state; nothing diverged.
    expect(await screen.findByText('7')).toBeInTheDocument();
    await settle();
    expect(api.dashboard.get).toHaveBeenCalledTimes(2);
  });

  it('does not corrupt state when events arrive out of order', async () => {
    const api = createStubApi();
    vi.mocked(api.dashboard.get).mockResolvedValue(
      makeDashboard({ summary: { ...makeDashboard().summary, completedMatches: 9 } }),
    );
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory, coalesceMs: 30 });
    expect(await screen.findByText('9')).toBeInTheDocument();
    act(() => {
      sources[0]?.open();
    });

    // A, B, A ordering: the client never reconstructs state from the events, so
    // the final render is the authoritative REST value regardless of order.
    act(() => {
      sources[0]?.message('MATCH_SCHEDULED');
      sources[0]?.message('MATCH_STARTED');
      sources[0]?.message('MATCH_SCHEDULED');
    });

    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('9')).toBeInTheDocument();
  });
});

describe('Phase 8.6 reconnect and missed-event recovery', () => {
  it('refetches authoritative state after a reconnect', async () => {
    const api = createStubApi();
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory });
    await screen.findByText('Live matches');
    act(() => {
      sources[0]?.open();
    });
    expect(api.dashboard.get).toHaveBeenCalledTimes(1);

    // Connection lost (the browser retries), then reconnects. Events may have
    // been missed and there is no replay, so the reconnect must refetch.
    act(() => {
      sources[0]?.reconnect();
    });
    act(() => {
      sources[0]?.open();
    });

    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(2);
    });
  });

  it('refetches once for a rapid reconnect flurry, not once per open', async () => {
    const api = createStubApi();
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory, coalesceMs: 40 });
    await screen.findByText('Live matches');
    act(() => {
      sources[0]?.open();
    });
    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(1);
    });

    // Let each transition propagate (batched state updates would hide the
    // intermediate RECONNECTING), then assert the flurry collapses to one refetch.
    act(() => {
      sources[0]?.reconnect();
    });
    act(() => {
      sources[0]?.open();
    });
    act(() => {
      sources[0]?.reconnect();
    });
    act(() => {
      sources[0]?.open();
    });

    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(2);
    });
    await settle();
    expect(api.dashboard.get).toHaveBeenCalledTimes(2);
  });

  it('recovers the authoritative current state after missed events', async () => {
    const api = createStubApi();
    // Nullable reads render nothing, so the only numeric text is the summary.
    vi.mocked(api.matches.getResult).mockResolvedValue(null);
    vi.mocked(api.entries.listByCategory).mockResolvedValue([]);
    // The dashboard the client last saw.
    vi.mocked(api.dashboard.get).mockResolvedValueOnce(
      makeDashboard({ summary: { ...makeDashboard().summary, completedMatches: 3 } }),
    );
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory });
    expect(await screen.findByText('3')).toBeInTheDocument();
    act(() => {
      sources[0]?.open();
    });

    // While offline, several mutations happen. No SSE event reaches the client.
    const afterMissedEvents: TournamentDashboardDto = makeDashboard({
      summary: { ...makeDashboard().summary, completedMatches: 8 },
    });
    vi.mocked(api.dashboard.get).mockResolvedValue(afterMissedEvents);

    act(() => {
      sources[0]?.reconnect();
    });
    act(() => {
      sources[0]?.open();
    });

    // The reconnect refetch surfaces the current authoritative state.
    expect(await screen.findByText('8')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Phase 8.6 isolation and lifecycle', () => {
  it('refreshes only the tournament whose stream delivered the event', async () => {
    const apiA = createStubApi();
    const apiB = createStubApi();
    const harnessA = createHarness();
    const harnessB = createHarness();

    renderLive(<TournamentDashboardPage />, { api: apiA, factory: harnessA.factory });
    renderLive(<TournamentDashboardPage />, {
      api: apiB,
      factory: harnessB.factory,
      tournamentId: OTHER_TOURNAMENT_ID,
    });

    await waitFor(() => {
      expect(apiA.dashboard.get).toHaveBeenCalledTimes(1);
      expect(apiB.dashboard.get).toHaveBeenCalledTimes(1);
    });
    act(() => {
      harnessA.sources[0]?.open();
      harnessB.sources[0]?.open();
    });

    act(() => {
      // Even an event whose payload claims tournament B cannot refresh B; the
      // provider only reacts to its own stream.
      harnessA.sources[0]?.message('MATCH_COMPLETED', OTHER_TOURNAMENT_ID);
    });

    await waitFor(() => {
      expect(apiA.dashboard.get).toHaveBeenCalledTimes(2);
    });
    expect(apiB.dashboard.get).toHaveBeenCalledTimes(1);
  });

  it('closes the stream and cancels a pending flush on unmount', async () => {
    const api = createStubApi();
    const { sources, factory } = createHarness();

    const { unmount } = renderLive(<TournamentDashboardPage />, {
      api,
      factory,
      coalesceMs: 80,
    });
    await screen.findByText('Live matches');
    act(() => {
      sources[0]?.open();
    });
    const source = sources[0];
    expect(api.dashboard.get).toHaveBeenCalledTimes(1);

    // An event is in flight, then the screen unmounts before the flush lands.
    act(() => {
      source?.message('MATCH_COMPLETED');
    });
    unmount();
    await settle();

    expect(source?.closeCalls).toBe(1);
    // The pending flush was cancelled: no refetch after the screen is gone.
    expect(api.dashboard.get).toHaveBeenCalledTimes(1);
  });
});

describe('Phase 8.6 REST failure and realtime-unavailable isolation', () => {
  it('surfaces a failed realtime-triggered refetch through existing error state, then recovers', async () => {
    const api = createStubApi();
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory, coalesceMs: 0 });
    await screen.findByText('Live matches');
    act(() => {
      sources[0]?.open();
    });

    vi.mocked(api.dashboard.get).mockRejectedValueOnce(new Error('temporary REST failure'));
    act(() => {
      sources[0]?.message('MATCH_COMPLETED');
    });

    // The screen shows the standard error state rather than crashing, and the
    // realtime connection is still usable.
    expect(await screen.findByTestId('error-state')).toBeInTheDocument();

    // A later event triggers another refresh, which succeeds and recovers the UI.
    act(() => {
      sources[0]?.message('MATCH_COMPLETED');
    });
    expect(await screen.findByText('Live matches')).toBeInTheDocument();
  });

  it('keeps REST and manual refresh working when the realtime stream is unavailable', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const factory = (): FakeEventSource => {
      throw new Error('EventSource unavailable');
    };

    renderLive(<TournamentDashboardPage />, { api, factory });

    // The initial REST load still renders.
    expect(await screen.findByText('Live matches')).toBeInTheDocument();
    expect(api.dashboard.get).toHaveBeenCalledTimes(1);

    // Manual refresh still works with the stream down.
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(2);
    });
  });
});
