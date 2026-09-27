import {
  createRealtimeDispatcher,
  createRealtimeEventPublisher,
  type RealtimeDispatcher,
  type RealtimeEventNotifier,
  type RealtimeEventPublisher,
  type RepositoryClient,
} from '@badminton/application';
import { createPostgresRealtimeEventNotifier } from '@badminton/infrastructure';

import type { ApiRealtime } from '../http/api-realtime.ts';

/**
 * Realtime composition root.
 *
 * Builds the in-memory publisher and the outbox dispatcher, and starts the
 * PostgreSQL `LISTEN`/`NOTIFY` wake-up. Kept in `composition` so no route or
 * service touches Prisma or a `pg` client directly.
 */
export interface RealtimeRuntime extends ApiRealtime {
  readonly dispatcher: RealtimeDispatcher;
  readonly notifier: RealtimeEventNotifier;
  readonly publisher: RealtimeEventPublisher;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CreateRealtimeRuntimeOptions {
  readonly client: RepositoryClient;
  readonly databaseUrl: string;
  readonly pollIntervalMs: number;
  readonly onError?: (error: unknown) => void;
}

export function createRealtimeRuntime(options: CreateRealtimeRuntimeOptions): RealtimeRuntime {
  const publisher = createRealtimeEventPublisher(
    options.onError ? { onSinkError: (error) => options.onError?.(error) } : {},
  );
  const dispatcher = createRealtimeDispatcher({
    repository: options.client.realtimeEvents,
    publisher,
    pollIntervalMs: options.pollIntervalMs,
    ...(options.onError ? { onError: options.onError } : {}),
  });
  const notifier = createPostgresRealtimeEventNotifier({
    connectionString: options.databaseUrl,
    ...(options.onError ? { onError: options.onError } : {}),
  });

  return {
    publisher,
    dispatcher,
    notifier,

    async start() {
      // Listen before the first drain so a committed insert during startup is
      // not missed by the poll cadence.
      await notifier.listen(() => {
        dispatcher.wake();
      });
      dispatcher.start();
    },

    async stop() {
      await dispatcher.stop();
      await notifier.close();
    },
  };
}
