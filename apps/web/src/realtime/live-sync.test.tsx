import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '@/api/context.tsx';
import type { TournamentDashboardDto } from '@/api/types.ts';
import { CategoryProvider, TournamentProvider } from '@/components/tournaments/context.tsx';
import { BracketSection } from '@/components/tournaments/knockout-bracket.tsx';
import type { RealtimeEventSource } from '@/realtime/realtime-client.ts';
import {
  RealtimeStatusIndicator,
  TournamentRealtimeProvider,
} from '@/realtime/tournament-refresh.tsx';
import { CourtBoardPage } from '@/pages/tournaments/court-board.tsx';
import { TournamentDashboardPage } from '@/pages/tournaments/dashboard.tsx';
import { MatchDetailPage } from '@/pages/tournaments/match-detail.tsx';
import { StageDetailPage } from '@/pages/tournaments/stage-detail.tsx';

import {
  createStubApi,
  makeCategory,
  makeDashboard,
  makeDashboardMatch,
  makeMatch,
  makeStage,
  makeTournament,
} from '../../tests/helpers.tsx';

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TOURNAMENT_ID = '99999999-9999-4999-8999-999999999999';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const STAGE_ID = '77777777-7777-4777-8777-777777777777';
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

  /** Emits a named event frame, exactly as the server frames it. */
  public message(event: string): void {
    const data = JSON.stringify({
      id: `event-${event}`,
      event,
      tournamentId: TOURNAMENT_ID,
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
  /** Wrap the screen in the category provider (required by category routes). */
  readonly inCategory?: boolean;
}

/** Renders `ui` inside the real providers plus the tournament realtime provider. */
function renderLive(ui: React.ReactNode, options: LiveOptions) {
  const tournamentId = options.tournamentId ?? TOURNAMENT_ID;
  const inner = (
    <TournamentRealtimeProvider
      tournamentId={tournamentId}
      eventSourceFactory={options.factory}
      refreshCoalesceMs={options.coalesceMs ?? 0}
    >
      <RealtimeStatusIndicator />
      {ui}
    </TournamentRealtimeProvider>
  );
  return render(
    <ApiProvider api={options.api}>
      <MemoryRouter>
        <TournamentProvider value={{ tournament: TOURNAMENT, refetch: vi.fn() }}>
          {options.inCategory ? (
            <CategoryProvider
              value={{ category: CATEGORY, tournament: TOURNAMENT, refetch: vi.fn() }}
            >
              {inner}
            </CategoryProvider>
          ) : (
            inner
          )}
        </TournamentProvider>
      </MemoryRouter>
    </ApiProvider>,
  );
}

describe('Phase 8.5 dashboard live synchronization', () => {
  it('refetches the dashboard REST query on an event and renders the new state', async () => {
    const api = createStubApi();
    const dashboardWithCompleted = (completed: number): TournamentDashboardDto =>
      makeDashboard({ summary: { ...makeDashboard().summary, completedMatches: completed } });
    vi.mocked(api.dashboard.get).mockResolvedValue(dashboardWithCompleted(10));
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory });

    // Initial REST load, then the stream opens.
    expect(await screen.findByText('10')).toBeInTheDocument();
    act(() => {
      sources[0]?.open();
    });
    // The initial CONNECTED must not duplicate the initial load.
    expect(api.dashboard.get).toHaveBeenCalledTimes(1);

    // A change happens elsewhere; the authoritative REST response now differs.
    vi.mocked(api.dashboard.get).mockResolvedValue(dashboardWithCompleted(11));
    act(() => {
      sources[0]?.message('MATCH_COMPLETED');
    });

    expect(await screen.findByText('11')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(2);
    });
  });

  it('coalesces a burst of events into a single refetch', async () => {
    const api = createStubApi();
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory, coalesceMs: 50 });

    await screen.findByText('Live matches');
    act(() => {
      sources[0]?.open();
    });

    // A result commit emits several events delivered back-to-back.
    act(() => {
      sources[0]?.message('MATCH_RESULT_RECORDED');
      sources[0]?.message('MATCH_COMPLETED');
      sources[0]?.message('KNOCKOUT_MATCH_POPULATED');
    });

    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(2);
    });
    // Give any (incorrect) extra scheduled refetches a chance to land.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(api.dashboard.get).toHaveBeenCalledTimes(2);
  });

  it('keeps manual refresh working alongside realtime', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory });
    await screen.findByText('Live matches');
    act(() => {
      sources[0]?.open();
    });
    expect(api.dashboard.get).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Phase 8.5 other live screens', () => {
  it('refreshes the court board on a court change', async () => {
    const api = createStubApi();
    const court = {
      courtId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      number: 1,
      name: 'Court 1',
      status: 'ACTIVE' as const,
      busy: false,
    };
    vi.mocked(api.dashboard.get).mockResolvedValue(makeDashboard({ courts: [court] }));
    const { sources, factory } = createHarness();

    renderLive(<CourtBoardPage />, { api, factory });

    expect((await screen.findAllByText('Court 1')).length).toBeGreaterThan(0);
    act(() => {
      sources[0]?.open();
    });

    vi.mocked(api.dashboard.get).mockResolvedValue(
      makeDashboard({ courts: [{ ...court, status: 'INACTIVE' }] }),
    );
    act(() => {
      sources[0]?.message('COURT_STATUS_CHANGED');
    });

    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(2);
    });
  });

  it('refreshes match and result data on match completion', async () => {
    const api = createStubApi();
    vi.mocked(api.matches.get).mockResolvedValue(makeMatch({ id: MATCH_ID, stageId: STAGE_ID }));
    const { sources, factory } = createHarness();

    renderLive(<MatchDetailPage />, { api, factory, inCategory: true });

    expect(await screen.findByRole('heading', { name: 'Match 1' })).toBeInTheDocument();
    act(() => {
      sources[0]?.open();
    });
    const initialMatchReads = vi.mocked(api.matches.get).mock.calls.length;
    const initialResultReads = vi.mocked(api.matches.getResult).mock.calls.length;

    act(() => {
      sources[0]?.message('MATCH_COMPLETED');
    });

    await waitFor(() => {
      expect(vi.mocked(api.matches.get).mock.calls.length).toBeGreaterThan(initialMatchReads);
    });
    expect(vi.mocked(api.matches.getResult).mock.calls.length).toBeGreaterThan(initialResultReads);
  });

  it('refreshes the knockout bracket on a knockout population event', async () => {
    const api = createStubApi();
    const { sources, factory } = createHarness();

    renderLive(
      <BracketSection
        stageId={STAGE_ID}
        categoryId={CATEGORY_ID}
        matchHref={(matchId) => `/matches/${matchId}`}
        refreshToken={0}
      />,
      { api, factory, inCategory: true },
    );

    expect(await screen.findByText(/2-entry bracket/)).toBeInTheDocument();
    act(() => {
      sources[0]?.open();
    });
    const initialBracketReads = vi.mocked(api.stages.getBracket).mock.calls.length;

    act(() => {
      sources[0]?.message('KNOCKOUT_MATCH_POPULATED');
    });

    await waitFor(() => {
      expect(vi.mocked(api.stages.getBracket).mock.calls.length).toBeGreaterThan(
        initialBracketReads,
      );
    });
  });

  it('refreshes group standings on a match completion', async () => {
    const api = createStubApi();
    vi.mocked(api.stages.get).mockResolvedValue(
      makeStage({ id: STAGE_ID, categoryId: CATEGORY_ID, type: 'GROUP' }),
    );
    const { sources, factory } = createHarness();

    renderLive(<StageDetailPage />, { api, factory, inCategory: true });

    expect(await screen.findByText('Standings')).toBeInTheDocument();
    act(() => {
      sources[0]?.open();
    });
    const initialStandingsReads = vi.mocked(api.stages.standings).mock.calls.length;

    act(() => {
      sources[0]?.message('MATCH_COMPLETED');
    });

    await waitFor(() => {
      expect(vi.mocked(api.stages.standings).mock.calls.length).toBeGreaterThan(
        initialStandingsReads,
      );
    });
  });
});

describe('Phase 8.5 reconnect handling', () => {
  it('refetches authoritative REST state after a reconnect', async () => {
    const api = createStubApi();
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory });
    await screen.findByText('Live matches');

    act(() => {
      sources[0]?.open();
    });
    expect(api.dashboard.get).toHaveBeenCalledTimes(1);

    // Connection drops, the browser retries on its own, then reconnects. Events
    // may have occurred while offline and Phase 8.2 does not replay, so the
    // reconnect must refetch authoritative state.
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

  it('does not treat the initial connection as a reconnect', async () => {
    const api = createStubApi();
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory });
    await screen.findByText('Live matches');

    act(() => {
      sources[0]?.open();
    });
    act(() => {
      sources[0]?.open();
    });

    // Two open events with no intervening error: still the initial load only.
    expect(api.dashboard.get).toHaveBeenCalledTimes(1);
  });

  it('refetches on a reconnect even when the intervening drop is never rendered', async () => {
    const api = createStubApi();
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory });
    await screen.findByText('Live matches');

    act(() => {
      sources[0]?.open();
    });
    expect(api.dashboard.get).toHaveBeenCalledTimes(1);

    // A real browser can observe open -> error -> open with React collapsing the
    // intermediate RECONNECTING into the same render, so the committed status
    // goes CONNECTED -> CONNECTED and a status-derived effect never fires. The
    // reconnect must still refetch because the client reports each transition.
    act(() => {
      sources[0]?.reconnect();
      sources[0]?.open();
    });

    await waitFor(() => {
      expect(api.dashboard.get).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Phase 8.5 isolation, cleanup and failure handling', () => {
  it('only refreshes the affected tournament', async () => {
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
      harnessA.sources[0]?.message('MATCH_COMPLETED');
    });

    await waitFor(() => {
      expect(apiA.dashboard.get).toHaveBeenCalledTimes(2);
    });
    // Tournament B never saw the event, so it is not refetched.
    expect(apiB.dashboard.get).toHaveBeenCalledTimes(1);
  });

  it('does not refetch after the screen unmounts', async () => {
    const api = createStubApi();
    const { sources, factory } = createHarness();

    const { unmount } = renderLive(<TournamentDashboardPage />, { api, factory });
    await screen.findByText('Live matches');
    act(() => {
      sources[0]?.open();
    });
    expect(api.dashboard.get).toHaveBeenCalledTimes(1);
    const source = sources[0];

    unmount();
    act(() => {
      source?.message('MATCH_COMPLETED');
    });

    expect(api.dashboard.get).toHaveBeenCalledTimes(1);
    expect(source?.closeCalls).toBe(1);
  });

  it('shows the existing REST error handling when a realtime-triggered refetch fails', async () => {
    const api = createStubApi();
    const { sources, factory } = createHarness();

    renderLive(<TournamentDashboardPage />, { api, factory });
    await screen.findByText('Live matches');
    act(() => {
      sources[0]?.open();
    });

    vi.mocked(api.dashboard.get).mockRejectedValueOnce(new Error('network down'));
    act(() => {
      sources[0]?.message('MATCH_COMPLETED');
    });

    // The screen renders the standard error state rather than crashing.
    expect(await screen.findByTestId('error-state')).toBeInTheDocument();
  });

  it('renders REST data and stays usable when the realtime stream is unavailable', async () => {
    const api = createStubApi();
    vi.mocked(api.dashboard.get).mockResolvedValue(
      makeDashboard({ liveMatches: [makeDashboardMatch({ status: 'IN_PROGRESS' })] }),
    );
    // A construction failure must not crash the page.
    const factory = (): FakeEventSource => {
      throw new Error('EventSource unavailable');
    };

    renderLive(<TournamentDashboardPage />, { api, factory });

    expect(await screen.findByText('Live matches')).toBeInTheDocument();
    expect((await screen.findAllByText('Alice vs Bob')).length).toBeGreaterThan(0);
    const status = await screen.findByTestId('realtime-status');
    expect(status).toHaveAttribute('data-status', 'DISCONNECTED');
  });
});
