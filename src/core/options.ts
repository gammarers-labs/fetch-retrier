/**
 * Public option types for {@link fetchRetrier}.
 */

/**
 * `fetch` options forwarded to every attempt, excluding `signal`.
 *
 * Use for `method`, `body`, `credentials`, `redirect`, `mode`, `cache`, and other
 * {@link https://developer.mozilla.org/en-US/docs/Web/API/RequestInit | RequestInit} fields.
 * Per-attempt abort and timeout are handled internally via `signal` and must not be set here.
 */
export type FetchInitOptions = Omit<RequestInit, 'signal'>;

/**
 * Options for {@link fetchRetrier}: retry policy, timeout, backoff (including `Retry-After`),
 * request payload, and cancellation.
 *
 * Request shape is built as `{ ...init, headers?, signal }` on each attempt. Top-level `headers`
 * override `init.headers` when both are provided.
 *
 * Numeric fields are validated when {@link fetchRetrier} is called; invalid values throw
 * {@link FetchRetrierInvalidOptionsError}.
 */
export interface RequestOptions {
  /**
   * HTTP headers sent on every attempt.
   * When `init.headers` is also set, these values take precedence for duplicate keys.
   */
  headers?: Record<string, string>;
  /**
   * Additional {@link FetchInitOptions} merged into each `fetch` call (e.g. POST `method` and JSON `body`).
   * The same `init` is reused across retries.
   */
  init?: FetchInitOptions;
  /**
   * Maximum number of attempts, including the first.
   * Must be `>= 1`.
   */
  retries: number;
  /**
   * Per-attempt timeout in milliseconds; uses an internal {@link AbortController} when exceeded.
   * Must be `> 0`.
   */
  timeoutMs: number;
  /**
   * Base backoff in milliseconds for full jitter when `Retry-After` is absent or invalid.
   * The exponential span for attempt `n` is `baseBackoffMs * 2^n`, then the result is clipped
   * by {@link RequestOptions.maxBackoffMs} when that option is set.
   * Must be `>= 0` (`0` skips backoff delay between attempts when falling back to jitter).
   */
  baseBackoffMs: number;
  /**
   * Optional ceiling in milliseconds applied to the full-jitter delay.
   * When set, `Math.min(jitter, maxBackoffMs)` is used. Does not clip a valid `Retry-After`.
   * Must be `>= 0` when provided (`0` skips jitter wait). Omitted means no extra clip.
   */
  maxBackoffMs?: number;
  /**
   * Optional external {@link AbortSignal}. When aborted during an attempt, the in-flight request
   * is aborted. On the last attempt this surfaces as {@link FetchRetrierAbortError}. If retries
   * remain, the next attempt sees the still-aborted signal and throws
   * {@link FetchRetrierAlreadyAbortedError}. Distinct from per-attempt timeout, which retries
   * remaining attempts and only then throws {@link FetchRetrierAbortError}.
   */
  signal?: AbortSignal;
  /**
   * Invoked after `response.text()` when `response.ok` is false.
   * Return `true` to schedule another attempt (until `retries` is exhausted).
   * Default: {@link defaultShouldRetry} (see {@link DEFAULT_RETRYABLE_HTTP_STATUSES}).
   *
   * @param response - Non-OK response from the current attempt
   * @param body - Response body text from `response.text()`
   * @returns `true` to schedule another attempt (until `retries` is exhausted)
   */
  shouldRetry?: (response: Response, body: string) => boolean;
}
