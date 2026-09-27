/**
 * Success payload conventions for the REST API.
 *
 * Every endpoint returns either `{ data: <resource> }` or `{ data: [...] }`, so
 * clients can parse responses uniformly without per-endpoint special cases.
 */
export interface DataResponse<T> {
  readonly data: T;
}

/** Wraps a single resource or collection in the `data` envelope. */
export function data<T>(value: T): DataResponse<T> {
  return { data: value };
}
