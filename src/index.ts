/**
 * Retry-enabled `fetch` wrapper with per-attempt timeout, Retry-After support, full-jitter backoff,
 * option validation, and typed errors.
 *
 * @module fetch-retrier
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
   * The cap for attempt `n` is `baseBackoffMs * 2^n`.
   * Must be `>= 0` (`0` skips backoff delay between attempts when falling back to jitter).
   */
  baseBackoffMs: number;
  /**
   * Optional external {@link AbortSignal}. When aborted, the in-flight request is aborted; on the
   * final attempt, cancellation surfaces as {@link FetchRetrierAbortError}.
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
 * Error thrown when a request is cancelled by timeout or an external {@link AbortSignal}.
 */
export class FetchRetrierAbortError extends Error {
  override readonly name: string = 'FetchRetrierAbortError';
  /**
   * @param message - Human-readable reason (default: `'Aborted'`)
   */
  constructor(message = 'Aborted') {
    super(message);
    Object.setPrototypeOf(this, FetchRetrierAbortError.prototype);
  }
}

/**
 * Error thrown when {@link RequestOptions.signal} is already aborted before an attempt starts.
 */
export class FetchRetrierAlreadyAbortedError extends FetchRetrierAbortError {
  override readonly name: string = 'FetchRetrierAlreadyAbortedError';
  /**
   * @param message - Human-readable reason (default: `'Signal was already aborted'`)
   */
  constructor(message = 'Signal was already aborted') {
    super(message);
    Object.setPrototypeOf(this, FetchRetrierAlreadyAbortedError.prototype);
  }
}

/**
 * Error thrown when the server returns a non-OK HTTP status and no further retry is performed.
 *
 * Carries the last response `status` and the body text already consumed via `response.text()`
 * (the same text passed to {@link RequestOptions.shouldRetry}).
 *
 * @property status - HTTP status code from the last non-OK response
 * @property body - Response body text already read via `response.text()` for that attempt
 */
export class FetchRetrierHttpError extends Error {
  override readonly name: string = 'FetchRetrierHttpError';
  /**
   * @param message - Error description
   * @param status - HTTP status code from the last non-OK response
   * @param body - Response body text already read via `response.text()` for that attempt
   */
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    Object.setPrototypeOf(this, FetchRetrierHttpError.prototype);
  }
}

/**
 * Error thrown when a fetch fails with a network-level error (e.g. DNS failure, connection refused).
 *
 * @property cause - Original error from the underlying `fetch`, when available
 */
export class FetchRetrierNetworkError extends Error {
  override readonly name: string = 'FetchRetrierNetworkError';
  /**
   * @param message - Human-readable reason (default: `'Network error'`)
   * @param cause - Original error from the underlying `fetch`, when available
   */
  constructor(message = 'Network error', public readonly cause?: unknown) {
    super(message);
    Object.setPrototypeOf(this, FetchRetrierNetworkError.prototype);
  }
}

/**
 * Error thrown when {@link RequestOptions} contains invalid numeric values.
 *
 * Subclass of {@link TypeError} for compatibility with `instanceof TypeError`. Distinct from
 * network-level `TypeError` values thrown by `fetch`, which are retried and surfaced as
 * {@link FetchRetrierNetworkError} after the last attempt.
 */
export class FetchRetrierInvalidOptionsError extends TypeError {
  override readonly name: string = 'FetchRetrierInvalidOptionsError';
  /**
   * @param message - Human-readable reason describing the invalid option
   */
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, FetchRetrierInvalidOptionsError.prototype);
  }
}

/**
 * Error thrown when an internal invariant fails (should not happen in normal use).
 */
export class FetchRetrierUnreachableError extends Error {
  override readonly name: string = 'FetchRetrierUnreachableError';
  /**
   * @param message - Human-readable reason (default: `'Unreachable'`)
   */
  constructor(message = 'Unreachable') {
    super(message);
    Object.setPrototypeOf(this, FetchRetrierUnreachableError.prototype);
  }
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
 * Constraints: `retries >= 1`, `timeoutMs > 0`, `baseBackoffMs >= 0`.
 *
 * @param options - Options whose `retries`, `timeoutMs`, and `baseBackoffMs` are checked
 * @throws {FetchRetrierInvalidOptionsError} When any constraint is violated
 */
const validateRequestOptions = (options: Pick<RequestOptions, 'retries' | 'timeoutMs' | 'baseBackoffMs'>): void => {
  const { retries, timeoutMs, baseBackoffMs } = options;

  if (retries < 1) {
    throw new FetchRetrierInvalidOptionsError('retries must be >= 1');
  }
  if (timeoutMs <= 0) {
    throw new FetchRetrierInvalidOptionsError('timeoutMs must be > 0');
  }
  if (baseBackoffMs < 0) {
    throw new FetchRetrierInvalidOptionsError('baseBackoffMs must be >= 0');
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
 * always use full jitter. The same {@link FetchInitOptions} (including `body`) is reused on
 * every attempt.
 *
 * @param url - Request URL passed to `fetch`
 * @param options - {@link RequestOptions} controlling retries, timeout, request init, and cancellation
 * @returns The first {@link Response} for which `ok` is `true`
 * @throws {FetchRetrierInvalidOptionsError} If `retries < 1`, `timeoutMs <= 0`, or `baseBackoffMs < 0`
 * @throws {FetchRetrierAlreadyAbortedError} If `options.signal` is already aborted before an attempt
 * @throws {FetchRetrierHttpError} On a non-OK response that is not retried or after the last attempt
 *   (includes `status` and `body`)
 * @throws {FetchRetrierNetworkError} On a network `TypeError` after the last attempt
 * @throws {FetchRetrierAbortError} On timeout or external abort after the last attempt
 * @throws {FetchRetrierUnreachableError} If the retry loop exits without returning (internal bug)
 */
export const fetchRetrier = async (url: string, options: RequestOptions): Promise<Response> => {
  const {
    headers,
    init,
    retries,
    timeoutMs,
    baseBackoffMs,
    signal: externalSignal,
    shouldRetry = defaultShouldRetry,
  } = options;

  validateRequestOptions({ retries, timeoutMs, baseBackoffMs });

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

      if (isContinue) {
        if (attempt === retries) {
          throw new FetchRetrierHttpError(`HTTP ${res.status}`, res.status, text);
        }
        await wait(resolveRetryDelayMs(res, baseBackoffMs, attempt));
      } else {
        throw new FetchRetrierHttpError(`Non-retriable HTTP error: ${res.status}`, res.status, text);
      }
    } catch (err: unknown) {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);

      if (err instanceof Error && err.name === 'AbortError') {
        if (attempt === retries) throw err instanceof FetchRetrierAbortError ? err : new FetchRetrierAbortError();
        await wait(fullJitter(baseBackoffMs, attempt));
        continue;
      }

      if (err instanceof TypeError) {
        if (attempt === retries) throw new FetchRetrierNetworkError('Network error', err);
        await wait(fullJitter(baseBackoffMs, attempt));
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
 * `Retry-After` header.
 *
 * @param base - Base backoff in milliseconds
 * @param attempt - 1-based attempt index (first retry uses `attempt === 1`)
 * @returns Wait duration in milliseconds before the next attempt
 */
const fullJitter = (base: number, attempt: number): number => {
  const cap = base * Math.pow(2, attempt);
  return Math.floor(Math.random() * cap);
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
 * @param nowMs - Current time in milliseconds (injectable for tests)
 * @returns Wait duration in milliseconds before the next attempt
 */
const resolveRetryDelayMs = (
  response: Response,
  baseBackoffMs: number,
  attempt: number,
  nowMs: number = Date.now(),
): number => {
  const header = response.headers?.get('Retry-After');
  if (header == null) {
    return fullJitter(baseBackoffMs, attempt);
  }

  const fromHeader = parseRetryAfterMs(header, nowMs);
  if (fromHeader === undefined) {
    return fullJitter(baseBackoffMs, attempt);
  }

  return fromHeader;
};
