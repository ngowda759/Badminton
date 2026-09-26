import { ConfigurationError, getServerEnv } from '@badminton/config';
import { connectDatabase, type DatabaseConnection } from '@badminton/database';

import { buildApp } from './app.ts';
import { createApiConfig, type ApiConfig } from './config/app-config.ts';
import { createDatabaseHealthChecks } from './infrastructure/database.ts';

/** Host the API binds to. `0.0.0.0` is required inside containers. */
const LISTEN_HOST = '0.0.0.0';

/** Signal-driven shutdown budget before the process is killed. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function start(): Promise<void> {
  const config: ApiConfig = createApiConfig(getServerEnv());

  const database: DatabaseConnection = connectDatabase(config.databaseUrl);
  const app = buildApp({
    checks: createDatabaseHealthChecks(database),
    corsOrigins: config.corsOrigins,
    logger: config.logger,
  });

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
