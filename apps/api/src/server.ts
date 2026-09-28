import { ConfigurationError, getServerEnv } from '@badminton/config';
import { connectDatabase, type DatabaseConnection } from '@badminton/database';
import { createPrismaUnitOfWork, createRepositoryClient } from '@badminton/infrastructure';

import { buildApp } from './app.ts';
import { createApiServices } from './composition/api-services.ts';
import { createRealtimeRuntime } from './composition/realtime.ts';
import { createApiConfig, type ApiConfig } from './config/app-config.ts';
import { createDatabaseHealthChecks } from './infrastructure/database.ts';

/** Host the API binds to. `0.0.0.0` is required inside containers. */
const LISTEN_HOST = '0.0.0.0';

/** Signal-driven shutdown budget before the process is killed. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function start(): Promise<void> {
  const config: ApiConfig = createApiConfig(getServerEnv());

  const database: DatabaseConnection = connectDatabase(config.databaseUrl);

  // Compose the application services over the single Prisma client. Creating
  // the repositories and unit of work here (not in a route) keeps Prisma out of
  // the HTTP layer while giving every service the same connection pool.
  const client = createRepositoryClient(database.prisma);
  const services = createApiServices(client, createPrismaUnitOfWork(database.prisma));

  // Realtime: the dispatcher drains the durable outbox and forwards committed
  // events to the publisher; the notifier wakes it from another process. The
  // dispatcher owns its own poll, so it is started after the app is built.
  // Errors are routed to the app logger through a late-bound hook, since the
  // runtime (which owns the publisher) is built before the Fastify instance.
  let logRealtimeError: (error: unknown) => void = () => undefined;
  const realtime = createRealtimeRuntime({
    client,
    databaseUrl: config.databaseUrl,
    pollIntervalMs: config.realtimePollIntervalMs,
    onError: (error) => {
      logRealtimeError(error);
    },
  });

  const app = buildApp({
    checks: createDatabaseHealthChecks(database),
    corsOrigins: config.corsOrigins,
    services,
    realtime,
    realtimeHeartbeatIntervalMs: config.realtimeHeartbeatIntervalMs,
    logger: config.logger,
    trustProxy: config.trustProxy,
  });

  logRealtimeError = (error) => {
    app.log.error({ err: error }, 'realtime error');
  };

  await realtime.start();
  app.log.info({ pollIntervalMs: config.realtimePollIntervalMs }, 'realtime dispatcher started');

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    app.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      app.log.error('graceful shutdown timed out, exiting');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      await app.close();
      await realtime.stop();
      await database.disconnect();
      clearTimeout(timer);
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: LISTEN_HOST });
}

start().catch((error: unknown) => {
  if (error instanceof ConfigurationError) {
    // Variable names and constraint messages only - never values.
    process.stderr.write(`Configuration error:\n${error.message}\n`);
  } else {
    process.stderr.write('Failed to start API. See logs for details.\n');
    if (error instanceof Error) {
      process.stderr.write(`${error.message}\n`);
    }
  }
  process.exit(1);
});
