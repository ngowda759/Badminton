import { parseClientEnvironment, type ClientEnv } from '@badminton/config/client';

/**
 * Validated, browser-visible configuration.
 *
 * `import.meta.env` is statically replaced by Vite at build time, so the values
 * must be referenced literally rather than through a dynamic lookup. Only
 * `VITE_`-prefixed variables are available here - anything else would leak
 * server configuration into the client bundle.
 */
export const env: ClientEnv = parseClientEnvironment({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
});
