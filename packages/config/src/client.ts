import { clientEnvSchema, type ClientEnv } from './schema.ts';
import { ConfigurationError } from './errors.ts';

export type { ClientEnv } from './schema.ts';

/**
 * Validates the browser-visible environment.
 *
 * Vite statically replaces `import.meta.env.*` references, so callers must pass
 * the values in explicitly (see `apps/web/src/config/env.ts`). Only variables
 * prefixed with `VITE_` may be used here; anything else would leak server
 * configuration into the client bundle.
 */
export function parseClientEnvironment(input: Record<string, string | undefined>): ClientEnv {
  const result = clientEnvSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigurationError(`Invalid client configuration: ${result.error.message}`);
  }
  return result.data;
}
