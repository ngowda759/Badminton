/** A single field-level problem returned by the API error envelope. */
export interface ApiErrorDetail {
  readonly path: string;
  readonly message: string;
}

/**
 * Structured failure for every request the API client makes.
 *
 * Components never see a raw `Response`, an HTML error page or a driver
 * message: network failures, malformed bodies and API error envelopes are all
 * normalised into this type. `message` is always safe to display.
 */
export class ApiError extends Error {
  public override readonly name = 'ApiError';

  constructor(
    /** HTTP status, or `0` when the request never reached the server. */
    public readonly status: number,
    /** Stable machine-readable code (`VALIDATION_ERROR`, `CONFLICT`, …). */
    public readonly code: string,
    message: string,
    /** Field-level problems, when the server supplied them. */
    public readonly details: readonly ApiErrorDetail[] = [],
  ) {
    super(message);
  }

  /** True when the request failed before a response was received. */
  public get isNetworkError(): boolean {
    return this.status === 0;
  }
}

/** Low-level transport used by every domain API module. */
export interface ApiClient {
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  patch<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  delete(path: string, signal?: AbortSignal): Promise<void>;
  /** DELETE for an endpoint that returns a `{ data }` body (e.g. unscheduling). */
  deleteResource<T>(path: string, signal?: AbortSignal): Promise<T>;
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

const NETWORK_ERROR_MESSAGE = 'Unable to reach the server. Check your connection and try again.';
const UNEXPECTED_ERROR_MESSAGE = 'The server returned an unexpected response.';
const INTERNAL_ERROR_MESSAGE = 'The server encountered an error. Please try again.';

interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: readonly { readonly path: string; readonly message: string }[];
  };
}

/** True when a parsed body looks like the API's error envelope. */
function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return false;
  }
  const error: unknown = body.error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

/** Reads the `data` field out of a success envelope, if present. */
function unwrapData(body: unknown): unknown {
  if (typeof body === 'object' && body !== null && 'data' in body) {
    return body.data;
  }
  return undefined;
}

/** Parses a JSON body, returning `undefined` for empty or invalid payloads. */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Builds the `ApiError` for a non-2xx response. */
function toApiError(status: number, body: unknown): ApiError {
  if (isErrorEnvelope(body)) {
    const { code, message, details } = body.error;
    return new ApiError(status, code, message, details ?? []);
  }

  const message = status >= 500 ? INTERNAL_ERROR_MESSAGE : UNEXPECTED_ERROR_MESSAGE;
  return new ApiError(status, status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR', message);
}

/**
 * Centralized HTTP transport for the browser.
 *
 * Owns the base URL, headers, JSON parsing and error translation so that no
 * component ever builds a `fetch` call by hand. Every domain module in
 * `apps/web/src/api` is a thin, typed wrapper over this client.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      // A caller-initiated abort is not a failure the UI should display.
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      throw new ApiError(0, 'NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const parsed = await readJson(response);

    if (!response.ok) {
      throw toApiError(response.status, parsed);
    }

    if (parsed === undefined) {
      throw new ApiError(response.status, 'INVALID_RESPONSE', UNEXPECTED_ERROR_MESSAGE);
    }

    const data = unwrapData(parsed);
    if (data === undefined) {
      throw new ApiError(response.status, 'INVALID_RESPONSE', UNEXPECTED_ERROR_MESSAGE);
    }

    return data as T;
  }

  return {
    get: (path, signal) => request('GET', path, undefined, signal),
    post: (path, body, signal) => request('POST', path, body, signal),
    patch: (path, pathBody, signal) => request('PATCH', path, pathBody, signal),
    delete: async (path, signal) => {
      await request<undefined>('DELETE', path, undefined, signal);
    },
    deleteResource: <T>(path: string, signal?: AbortSignal) =>
      request<T>('DELETE', path, undefined, signal),
  };
}
