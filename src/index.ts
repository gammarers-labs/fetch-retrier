/**
 * Retry-enabled `fetch` wrapper with per-attempt timeout, Retry-After support, full-jitter backoff,
 * option validation, and typed errors.
 *
 * @module fetch-retrier
 */

import {
  FetchRetrierAbortError,
  FetchRetrierAlreadyAbortedError,
  FetchRetrierError,
  FetchRetrierHttpError,
  FetchRetrierInvalidOptionsError,
  FetchRetrierNetworkError,
  FetchRetrierUnreachableError,
} from './core/errors';

export {
  FetchRetrierAbortError,
  FetchRetrierAlreadyAbortedError,
  FetchRetrierError,
  FetchRetrierHttpError,
  FetchRetrierInvalidOptionsError,
  FetchRetrierNetworkError,
  FetchRetrierUnreachableError,
};

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

/**
 * HTTP status codes retried by default when {@link RequestOptions.shouldRetry} is omitted.
 *
 * Includes transient client/server errors: 408, 425, 429, and common 5xx gateway or overload responses.
 */
export const DEFAULT_RETRYABLE_HTTP_STATUSES: readonly number[] = [408, 425, 429, 500, 502, 503, 504];

/**
 * Default {@link RequestOptions.shouldRetry}: retries responses whose status is in
 * {@link DEFAULT_RETRYABLE_HTTP_STATUSES}.
 *
 * Compose with custom logic, for example:
 * `(res, body) => defaultShouldRetry(res, body) || res.status === 418`.
 *
 * @param response - Response from the failed attempt
 * @param _body - Response body text (unused by the default predicate)
 * @returns `true` when another attempt should be scheduled
 */
export const defaultShouldRetry = (response: Response, _body: string): boolean => {
  return DEFAULT_RETRYABLE_HTTP_STATUSES.includes(response.status);
};

/**
 * Validates retry policy numeric fields on {@link RequestOptions}.
 *
 * Constraints: `retries >= 1`, `timeoutMs > 0`, `baseBackoffMs >= 0`, and when set
 * `maxBackoffMs >= 0`.
 *
 * @param options - Options whose `retries`, `timeoutMs`, `baseBackoffMs`, and optional
 *   `maxBackoffMs` are checked
 * @throws {FetchRetrierInvalidOptionsError} When any constraint is violated
 */
const validateRequestOptions = (
  options: Pick<RequestOptions, 'retries' | 'timeoutMs' | 'baseBackoffMs' | 'maxBackoffMs'>,
): void => {
  const { retries, timeoutMs, baseBackoffMs, maxBackoffMs } = options;

  if (retries < 1) {
    throw new FetchRetrierInvalidOptionsError('retries must be >= 1');
  }
  if (timeoutMs <= 0) {
    throw new FetchRetrierInvalidOptionsError('timeoutMs must be > 0');
  }
  if (baseBackoffMs < 0) {
    throw new FetchRetrierInvalidOptionsError('baseBackoffMs must be >= 0');
  }
  if (maxBackoffMs !== undefined && maxBackoffMs < 0) {
    throw new FetchRetrierInvalidOptionsError('maxBackoffMs must be >= 0');
  }
};

/**
 * Wraps `fetch` with retries, per-attempt timeout, Retry-After support, full-jitter backoff, and
 * optional cancellation.
 *
 * Each attempt calls `fetch(url, { ...options.init, headers?, signal })` with an internal
 * {@link AbortSignal} for `timeoutMs`. Non-OK responses are retried when `shouldRetry` returns
 * `true` (default: {@link defaultShouldRetry}). Between HTTP retries, a valid `Retry-After`
 * header (delta-seconds or HTTP-date) is preferred over full jitter; abort and network retries
 * always use full jitter. Optional {@link RequestOptions.maxBackoffMs} clips the jitter result,
 * not a valid `Retry-After`. The same {@link FetchInitOptions} (including `body`) is reused on
 * every attempt.
 *
 * @param url - Request URL passed to `fetch`
 * @param options - {@link RequestOptions} controlling retries, timeout, request init, and cancellation
 * @returns The first {@link Response} for which `ok` is `true`
 * @throws {FetchRetrierError} All failures from this function are subclasses of this class
 * @throws {FetchRetrierInvalidOptionsError} If `retries < 1`, `timeoutMs <= 0`, `baseBackoffMs < 0`,
 *   or `maxBackoffMs` is set and `< 0`
 * @throws {FetchRetrierAlreadyAbortedError} If `options.signal` is already aborted before an attempt,
 *   including the next attempt after an in-flight external abort while retries remain
 * @throws {FetchRetrierHttpError} On a non-OK response that is not retried or after the last attempt
 *   (includes `status` and `body`)
 * @throws {FetchRetrierNetworkError} On a network `TypeError` after the last attempt
 * @throws {FetchRetrierAbortError} On per-attempt timeout after the last attempt, or external abort
 *   on the last attempt
 * @throws {FetchRetrierUnreachableError} If the retry loop exits without returning (internal bug)
 */
export const fetchRetrier = async (url: string, options: RequestOptions): Promise<Response> => {
  const {
    headers,
    init,
    retries,
    timeoutMs,
    baseBackoffMs,
    maxBackoffMs,
    signal: externalSignal,
    shouldRetry = defaultShouldRetry,
  } = options;

  validateRequestOptions({ retries, timeoutMs, baseBackoffMs, maxBackoffMs });

  for (let attempt = 1; attempt <= retries; attempt++) {
    if (externalSignal?.aborted) {
      throw new FetchRetrierAlreadyAbortedError();
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const onExternalAbort = (): void => {
      clearTimeout(timer);
      controller.abort();
    };

    if (externalSignal) {
      externalSignal.addEventListener('abort', onExternalAbort);
    }

    try {
      const res = await fetch(url, {
        ...init,
        ...(headers !== undefined ? { headers } : {}),
        signal: controller.signal,
      });

      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);

      if (res.ok) {
        return res;
      }

      const text = await res.text();
      const isContinue = shouldRetry(res, text);

      if (!isContinue) {
        throw new FetchRetrierHttpError(`Non-retriable HTTP error: ${res.status}`, res.status, text);
      }

      if (attempt === retries) {
        throw new FetchRetrierHttpError(`HTTP ${res.status}`, res.status, text);
      }

      await wait(resolveRetryDelayMs(res, baseBackoffMs, attempt, maxBackoffMs));
    } catch (err: unknown) {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);

      if (err instanceof Error && err.name === 'AbortError') {
        if (attempt === retries) throw err instanceof FetchRetrierAbortError ? err : new FetchRetrierAbortError();
        await wait(fullJitter(baseBackoffMs, attempt, maxBackoffMs));
        continue;
      }

      if (err instanceof TypeError) {
        if (attempt === retries) throw new FetchRetrierNetworkError('Network error', err);
        await wait(fullJitter(baseBackoffMs, attempt, maxBackoffMs));
        continue;
      }

      throw err;
    }
  }

  throw new FetchRetrierUnreachableError();
};

/**
 * Delays execution for the given duration (used between retry attempts).
 *
 * @param ms - Delay in milliseconds
 * @returns A promise that resolves after `ms`
 */
const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Full jitter backoff: random delay in `[0, base * 2^attempt)` ms (AWS-recommended pattern).
 *
 * Used between abort/network retries, and as the fallback when HTTP retries lack a usable
 * `Retry-After` header. When `maxBackoffMs` is set, the computed delay is clipped with
 * `Math.min(delay, maxBackoffMs)`.
 *
 * @param base - Base backoff in milliseconds
 * @param attempt - 1-based attempt index (first retry uses `attempt === 1`)
 * @param maxBackoffMs - Optional ceiling applied to the jitter result
 * @returns Wait duration in milliseconds before the next attempt
 */
const fullJitter = (base: number, attempt: number, maxBackoffMs?: number): number => {
  const cap = base * Math.pow(2, attempt);
  const delay = Math.floor(Math.random() * cap);
  if (maxBackoffMs === undefined) {
    return delay;
  }
  return Math.min(delay, maxBackoffMs);
};

/**
 * Parses a `Retry-After` header value into a delay in milliseconds.
 *
 * Supports RFC 7231 forms: non-negative integer delta-seconds, or an HTTP-date. Empty values,
 * non-integer numerics (e.g. floats or negatives), and unparsable dates yield `undefined` so
 * callers can fall back to full jitter. An HTTP-date in the past yields `0`.
 *
 * @param value - Raw `Retry-After` header value
 * @param nowMs - Current time in milliseconds (injectable for tests)
 * @returns Delay in milliseconds, or `undefined` when the value cannot be parsed
 */
export const parseRetryAfterMs = (value: string, nowMs: number = Date.now()): number | undefined => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }

  // Reject other numeric forms (floats, negatives); not valid delta-seconds or HTTP-date.
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return undefined;
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }

  return Math.max(0, dateMs - nowMs);
};

/**
 * Chooses the delay before the next HTTP retry: prefer a valid `Retry-After`, else full jitter.
 *
 * Reads `response.headers.get('Retry-After')` and parses it with {@link parseRetryAfterMs}.
 * Missing headers, or values that parse to `undefined`, fall back to {@link fullJitter}.
 * Abort and network retries do not use this helper.
 *
 * @param response - Non-OK response from the current attempt
 * @param baseBackoffMs - Base backoff passed to {@link fullJitter} when falling back
 * @param attempt - 1-based attempt index
 * @param maxBackoffMs - Optional ceiling applied only to the jitter fallback
 * @param nowMs - Current time in milliseconds (injectable for tests)
 * @returns Wait duration in milliseconds before the next attempt
 */
const resolveRetryDelayMs = (
  response: Response,
  baseBackoffMs: number,
  attempt: number,
  maxBackoffMs?: number,
  nowMs: number = Date.now(),
): number => {
  const header = response.headers?.get('Retry-After');
  if (header == null) {
    return fullJitter(baseBackoffMs, attempt, maxBackoffMs);
  }

  const fromHeader = parseRetryAfterMs(header, nowMs);
  if (fromHeader === undefined) {
    return fullJitter(baseBackoffMs, attempt, maxBackoffMs);
  }

  return fromHeader;
};
