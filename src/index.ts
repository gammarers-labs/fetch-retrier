/**
 * Configuration for {@link fetchRetrier}.
 */
export interface RequestOptions {
  /** Optional HTTP headers sent with each attempt. */
  headers?: Record<string, string>;
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
   * Return `true` to schedule another attempt for this non-OK response.
   * Default: retry on status 429, 500, 502, 503, or 504.
   */
  shouldRetry?: (response: Response, body: string) => boolean;
}

/** Error thrown when a request is cancelled by timeout or an external {@link AbortSignal}. */
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

/** Error thrown when the server returns a non-OK HTTP status and no further retry is performed. */
export class FetchRetrierHttpError extends Error {
  override readonly name: string = 'FetchRetrierHttpError';
  /**
   * @param message - Error description
   * @param status - HTTP status code from the response
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
 */
export class FetchRetrierNetworkError extends Error {
  override readonly name: string = 'FetchRetrierNetworkError';
  /**
   * @param message - Human-readable reason (default: `'Network error'`)
   * @param cause - Original error, if any
   */
  constructor(message = 'Network error', public readonly cause?: unknown) {
    super(message);
    Object.setPrototypeOf(this, FetchRetrierNetworkError.prototype);
  }
}

/** Error thrown when an internal invariant fails (should not happen in normal use). */
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
 * Default {@link RequestOptions.shouldRetry} implementation: retry on HTTP 429, 500, 502, 503, 504.
 */
const defaultShouldRetry = (res: Response): boolean => {
  return [429, 500, 502, 503, 504].includes(res.status);
};

/**
 * Performs `fetch` with retries, a per-attempt timeout, exponential backoff with full jitter,
 * optional {@link RequestOptions.signal} cancellation, and a configurable retry predicate for
 * non-OK responses.
 *
 * @param url - Request URL
 * @param options - Retries, backoff, timeout, optional abort signal, and optional retry predicate
 * @returns The first successful (OK) {@link Response}
 * @throws {FetchRetrierAlreadyAbortedError} If `options.signal` is already aborted before an attempt
 * @throws {FetchRetrierHttpError} On a non-OK response that is not retried or after the last attempt
 * @throws {FetchRetrierNetworkError} On a network error on the final attempt
 * @throws {FetchRetrierAbortError} On timeout or external abort on the final attempt
 * @throws {FetchRetrierUnreachableError} If the retry loop exits without returning (internal bug)
 */
export const fetchRetrier = async (url: string, options: RequestOptions): Promise<Response> => {
  const { headers, retries, timeoutMs, baseBackoffMs, signal: externalSignal, shouldRetry = defaultShouldRetry } = options;

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
        headers,
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
