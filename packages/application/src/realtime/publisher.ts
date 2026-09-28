import type { RealtimeEvent } from '@badminton/domain';

/**
 * Realtime publisher / subscriber registry.
 *
 * This is the *distribution* half of realtime: it holds no business logic and
 * only forwards an already-persisted event to the sinks subscribed to that
 * tournament. Subscribers are grouped by `tournamentId`, so an event for
 * Tournament A can never be delivered to a subscriber of Tournament B.
 *
 * The application defines the port; a future SSE transport (Phase 8.2) supplies
 * a sink that writes to an HTTP response. Keeping this in-memory registry in the
 * application layer means the scoping rule is testable without a socket.
 */
export interface RealtimeSubscriberSink {
  send(event: RealtimeEvent): Promise<void> | void;
}

export interface RealtimeEventPublisher {
  /** Subscribes `sink` to one tournament; the returned function unsubscribes. */
  subscribe(tournamentId: string, sink: RealtimeSubscriberSink): () => void;
  /**
   * Delivers `event` to the sinks of its tournament. A sink that throws is
   * isolated - one broken connection never blocks the others - and reported
   * through `onSinkError`. Having no sink is not an error.
   */
  publish(event: RealtimeEvent): Promise<void>;
  /** The tournaments that currently have at least one subscriber. */
  tournaments(): readonly string[];
}

export interface RealtimeEventPublisherOptions {
  /** Reports a sink that failed while receiving an event (never re-thrown). */
  readonly onSinkError?: (error: unknown, event: RealtimeEvent) => void;
}

export function createRealtimeEventPublisher(
  options: RealtimeEventPublisherOptions = {},
): RealtimeEventPublisher {
  const byTournament = new Map<string, Set<RealtimeSubscriberSink>>();

  return {
    subscribe(tournamentId, sink) {
      const sinks = byTournament.get(tournamentId) ?? new Set<RealtimeSubscriberSink>();
      sinks.add(sink);
      byTournament.set(tournamentId, sinks);

      return () => {
        const current = byTournament.get(tournamentId);
        if (!current) {
          return;
        }
        current.delete(sink);
        if (current.size === 0) {
          byTournament.delete(tournamentId);
        }
      };
    },

    async publish(event) {
      const sinks = byTournament.get(event.tournamentId);
      if (!sinks || sinks.size === 0) {
        return;
      }
      // Deliver from a snapshot so a sink that unsubscribes mid-publish does not
      // disturb the iteration.
      const deliveries = [...sinks].map(async (sink) => {
        try {
          await sink.send(event);
        } catch (error: unknown) {
          options.onSinkError?.(error, event);
        }
      });
      await Promise.all(deliveries);
    },

    tournaments() {
      return [...byTournament.keys()];
    },
  };
}
