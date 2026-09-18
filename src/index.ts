/**
 * Retry-enabled `fetch` wrapper with per-attempt timeout, Retry-After support, full-jitter backoff,
 * option validation, and typed errors.
 *
 * @module fetch-retrier
 */

export {
  FetchRetrierAbortError,
  FetchRetrierAlreadyAbortedError,
  FetchRetrierError,
  FetchRetrierHttpError,
  FetchRetrierInvalidOptionsError,
  FetchRetrierNetworkError,
  FetchRetrierUnreachableError,
} from './core/errors';
export type { FetchInitOptions, RequestOptions } from './core/options';
export { parseRetryAfterMs } from './core/backoff/retry-after';
export { fetchRetrier } from './core/fetch-retrier';
export {
  DEFAULT_RETRYABLE_HTTP_STATUSES,
  defaultShouldRetry,
} from './core/policy/default-should-retry';
