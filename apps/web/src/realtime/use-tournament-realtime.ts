import { useEffect, useRef, useState } from 'react';

import { tournamentIdSchema } from '@badminton/validation';

import { env } from '@/config/env.ts';

import {
  buildTournamentEventsUrl,
  createTournamentRealtimeClient,
  type EventSourceFactory,
} from './realtime-client.ts';
import type { RealtimeConnectionStatus, RealtimeEvent } from './realtime-types.ts';

/** What the UI reads before the first status transition. */
const INITIAL_STATUS: RealtimeConnectionStatus = 'DISCONNECTED';

export interface UseTournamentRealtimeOptions {
  /** Called for every well-formed event; the primary signal for Phase 8.5. */
  readonly onEvent?: (event: RealtimeEvent) => void;
  /** Test seam; defaults to a native browser `EventSource`. */
  readonly eventSourceFactory?: EventSourceFactory;
}

export interface TournamentRealtime {
  /** Current connection state; `DISCONNECTED` before the stream opens. */
  readonly status: RealtimeConnectionStatus;
  /** The most recent event for the current tournament, or `null`. */
  readonly lastEvent: RealtimeEvent | null;
}

/** An event tagged with the tournament it belongs to. */
interface TaggedEvent {
  readonly tournamentId: string;
  readonly event: RealtimeEvent;
}

/**
 * Subscribes a component to one tournament's realtime stream.
 *
 * Thin React binding over {@link createTournamentRealtimeClient}: it owns the
 * client's lifecycle (one `EventSource` per mount, closed on unmount and when
 * the tournament id changes) and exposes the connection status plus the latest
 * event. It never fetches or mutates data - a consumer reacts to `onEvent` /
 * `lastEvent` by refetching REST itself (Phase 8.5).
 *
 * Callbacks live in refs so a consumer may pass an inline function without the
 * effect re-running and reopening the socket. The effect depends only on the
 * tournament id, so React Strict Mode's double invocation ends with exactly one
 * live connection.
 */
export function useTournamentRealtime(
  tournamentId: string,
  options: UseTournamentRealtimeOptions = {},
): TournamentRealtime {
  const [status, setStatus] = useState<RealtimeConnectionStatus>(INITIAL_STATUS);
  const [tagged, setTagged] = useState<TaggedEvent | null>(null);

  const onEventRef = useRef(options.onEvent);
  const factoryRef = useRef(options.eventSourceFactory);
  useEffect(() => {
    onEventRef.current = options.onEvent;
    factoryRef.current = options.eventSourceFactory;
  }, [options.onEvent, options.eventSourceFactory]);

  useEffect(() => {
    // An absent or malformed id never opens a connection. Nothing is set here:
    // the previous tournament's cleanup already drove the status to
    // DISCONNECTED, and `lastEvent` below is derived per tournament.
    if (!tournamentIdSchema.safeParse(tournamentId).success) {
      return undefined;
    }

    const factory = factoryRef.current;
    const client = createTournamentRealtimeClient({
      url: buildTournamentEventsUrl(env.VITE_API_BASE_URL, tournamentId),
      onStatus: setStatus,
      onEvent: (event) => {
        setTagged({ tournamentId, event });
        onEventRef.current?.(event);
      },
      ...(factory ? { eventSourceFactory: factory } : {}),
    });

    client.start();

    return () => {
      client.stop();
    };
  }, [tournamentId]);

  // Deriving from the tag means a stale event from a previous tournament is
  // never surfaced after the id changes, without a state reset in the effect.
  const lastEvent = tagged && tagged.tournamentId === tournamentId ? tagged.event : null;

  return { status, lastEvent };
}
