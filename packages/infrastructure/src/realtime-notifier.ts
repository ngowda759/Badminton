import { REALTIME_NOTIFY_CHANNEL, type RealtimeEventNotifier } from '@badminton/application';
import { Client } from 'pg';

/**
 * PostgreSQL `LISTEN`/`NOTIFY` wake-up transport.
 *
 * It uses one dedicated `pg` connection, kept separate from the Prisma pool, so
 * a long-lived `LISTEN` never occupies a pooled client. A trigger on
 * `realtime_events` sends `pg_notify(<channel>, <tournamentId>)` after every
 * insert; because PostgreSQL delivers notifications only when the inserting
 * transaction commits, a rolled-back business change never wakes the dispatcher.
 *
 * The notification is a wake-up only: the durable outbox row is the source of
 * truth. A lost connection or a missed notification costs latency, never
 * correctness, because the dispatcher also polls. Failures are reported through
 * `onError` and never thrown.
 */
export interface PostgresNotifierOptions {
  readonly connectionString: string;
  readonly onError?: (error: unknown) => void;
  /** Delay before retrying a dropped listen connection. */
  readonly reconnectDelayMs?: number;
}

const DEFAULT_RECONNECT_DELAY_MS = 5_000;

export function createPostgresRealtimeEventNotifier(
  options: PostgresNotifierOptions,
): RealtimeEventNotifier {
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  let client: Client | undefined;
  let handler: ((tournamentId: string) => void) | undefined;
  let closed = false;
  let retryTimer: NodeJS.Timeout | undefined;

  function scheduleReconnect(): void {
    if (closed || retryTimer) {
      return;
    }
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, reconnectDelayMs);
    retryTimer.unref();
  }

  async function connect(): Promise<void> {
    if (closed || client) {
      return;
    }
    const connection = new Client({ connectionString: options.connectionString });
    try {
      await connection.connect();
      await connection.query(`LISTEN "${REALTIME_NOTIFY_CHANNEL}"`);
    } catch (error: unknown) {
      options.onError?.(error);
      await connection.end().catch(() => undefined);
      scheduleReconnect();
      return;
    }

    connection.on('notification', (message) => {
      // The payload is the tournament id; an unrecognised payload still wakes the
      // dispatcher, which reads the authoritative row itself.
      handler?.(message.payload ?? '');
    });
    connection.on('error', (error: Error) => {
      options.onError?.(error);
      client = undefined;
      void connection.end().catch(() => undefined);
      scheduleReconnect();
    });

    client = connection;
  }

  return {
    async listen(nextHandler) {
      handler = nextHandler;
      closed = false;
      await connect();
    },

    async close() {
      closed = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      const connection = client;
      client = undefined;
      if (connection) {
        await connection.end().catch(() => undefined);
      }
    },
  };
}
