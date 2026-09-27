import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** A lightweight reference to a resource the operator has created or opened. */
export interface RecentItem {
  readonly id: string;
  readonly label: string;
  readonly at: number;
}

interface RecentState {
  readonly tournaments: readonly RecentItem[];
  readonly players: readonly RecentItem[];
  readonly teams: readonly RecentItem[];
}

type RecentKind = keyof RecentState;

const EMPTY: RecentState = { tournaments: [], players: [], teams: [] };
const MAX_ITEMS = 20;
const STORAGE_KEY = 'badminton.recent';

interface RecentContextValue {
  readonly state: RecentState;
  readonly remember: (kind: RecentKind, item: { id: string; label: string }) => void;
}

const RecentContext = createContext<RecentContextValue>({
  state: EMPTY,
  remember: () => undefined,
});

/**
 * Remembers resources the operator has recently created or opened.
 *
 * Phase 3 exposes no collection endpoints for tournaments, players or teams,
 * so there is no way to list them from the API. To keep resources navigable
 * without fabricating a server-side list, the UI remembers the identifiers of
 * records it actually received from the API. This is a client-side index over
 * real API data, not stored domain data: each entry is re-fetched by id when
 * opened, and a record deleted or never created cannot appear here.
 */
export function RecentProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<RecentState>(() => readStored());

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage may be unavailable (private mode); the index is best-effort.
    }
  }, [state]);

  const remember = useCallback((kind: RecentKind, item: { id: string; label: string }) => {
    setState((current) => {
      const entry: RecentItem = { ...item, at: Date.now() };
      const next = [entry, ...current[kind].filter((existing) => existing.id !== item.id)].slice(
        0,
        MAX_ITEMS,
      );
      return { ...current, [kind]: next };
    });
  }, []);

  const value = useMemo(() => ({ state, remember }), [state, remember]);

  return <RecentContext.Provider value={value}>{children}</RecentContext.Provider>;
}

export function useRecent(): RecentContextValue {
  return useContext(RecentContext);
}

function readStored(): RecentState {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return EMPTY;
    }
    const parsed = JSON.parse(raw) as Partial<RecentState>;
    return {
      tournaments: sanitize(parsed.tournaments),
      players: sanitize(parsed.players),
      teams: sanitize(parsed.teams),
    };
  } catch {
    return EMPTY;
  }
}

function sanitize(value: unknown): readonly RecentItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is RecentItem =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as RecentItem).id === 'string' &&
      typeof (item as RecentItem).label === 'string',
  );
}
