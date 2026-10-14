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
export {
  DEFAULT_RETRYABLE_HTTP_STATUSES,
  defaultShouldRetry,
} from './default-should-retry';
export { fetchRetrier } from './fetch-retrier';
export type { FetchInitOptions, RequestOptions } from './fetch-retrier';
export { parseRetryAfterMs } from './parse-retry-after';
