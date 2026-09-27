import { createApiClient } from './client.ts';
import { createBadmintonApi, type BadmintonApi } from './services.ts';
import { env } from '@/config/env.ts';

/**
 * The application's single API instance.
 *
 * Composed at module scope so every page and hook shares one transport and one
 * base URL. Pages receive it through {@link ApiProvider} rather than importing
 * it directly, which keeps them testable against a stub API.
 */
export const api: BadmintonApi = createBadmintonApi(
  createApiClient({ baseUrl: env.VITE_API_BASE_URL }),
);

export type { BadmintonApi } from './services.ts';
export { ApiError, type ApiErrorDetail } from './client.ts';
export * from './types.ts';
