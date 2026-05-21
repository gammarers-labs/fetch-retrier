/**
 * Retry-enabled `fetch` wrapper with per-attempt timeout, full-jitter backoff, and typed errors.
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
 * Options for {@link fetchRetrier}: retry policy, timeout, backoff, request payload, and cancellation.
 *
 * Request shape is built as `{ ...init, headers?, signal }` on each attempt. Top-level `headers`
 * override `init.headers` when both are provided.
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
  /** Maximum number of attempts, including the first. */
  retries: number;
  /** Per-attempt timeout in milliseconds; uses an internal {@link AbortController} when exceeded. */
  timeoutMs: number;
  /**
   * Base backoff in milliseconds for full jitter. The cap for attempt `n` is `baseBackoffMs * 2^n`.
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
   * Default: retry on status 429, 500, 502, 503, or 504.
   *
   * @param response - Non-OK response from the current attempt
   * @param body - Response body text from `response.text()`
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
 * @property status - HTTP status code from the last non-OK response
 */
export class FetchRetrierHttpError extends Error {
  override readonly name: string = 'FetchRetrierHttpError';
  /**
   * @param message - Error description
   * @param status - HTTP status code from the last non-OK response
   */
  constructor(
    message: string,
    public readonly status: number,
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
 * Default {@link RequestOptions.shouldRetry}: retry on HTTP 429, 500, 502, 503, or 504.
 *
 * @param res - Response from the failed attempt
 * @returns `true` when another attempt should be scheduled
 */
const defaultShouldRetry = (res: Response): boolean => {
  return [429, 500, 502, 503, 504].includes(res.status);
};

/**
 * Wraps `fetch` with retries, per-attempt timeout, full-jitter backoff, and optional cancellation.
 *
 * Each attempt calls `fetch(url, { ...options.init, headers?, signal })` with an internal
 * {@link AbortSignal} for `timeoutMs`. Non-OK responses are retried when `shouldRetry` returns
 * `true` (default: 429 and 5xx). The same {@link FetchInitOptions} (including `body`) is reused
 * on every attempt.
 *
 * @param url - Request URL passed to `fetch`
 * @param options - {@link RequestOptions} controlling retries, timeout, request init, and cancellation
 * @returns The first {@link Response} for which `ok` is `true`
 * @throws {FetchRetrierAlreadyAbortedError} If `options.signal` is already aborted before an attempt
 * @throws {FetchRetrierHttpError} On a non-OK response that is not retried or after the last attempt
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
          throw new FetchRetrierHttpError(`HTTP ${res.status}`, res.status);
        }
        await wait(fullJitter(baseBackoffMs, attempt));
      } else {
        throw new FetchRetrierHttpError(`Non-retriable HTTP error: ${res.status}`, res.status);
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
 * @param base - Base backoff in milliseconds
 * @param attempt - 1-based attempt index (first retry uses `attempt === 1`)
 * @returns Wait duration in milliseconds before the next attempt
 */
const fullJitter = (base: number, attempt: number): number => {
  const cap = base * Math.pow(2, attempt);
  return Math.floor(Math.random() * cap);
};
