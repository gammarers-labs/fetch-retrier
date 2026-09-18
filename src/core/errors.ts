/**
 * Typed errors thrown by {@link fetchRetrier}.
 *
 * All public error classes extend {@link FetchRetrierError} so callers can catch any library
 * failure with one `instanceof` check.
 */

/**
 * Base class for every error thrown by this package.
 *
 * Catch {@link FetchRetrierError} to handle any library failure, or a subclass for a specific
 * case. Distinct from native `fetch` `TypeError` and `AbortError` values, which are wrapped
 * before they leave {@link fetchRetrier}.
 */
export class FetchRetrierError extends Error {
  override readonly name: string = 'FetchRetrierError';
  /**
   * @param message - Human-readable reason
   */
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, FetchRetrierError.prototype);
  }
}

/**
 * Error thrown when the last attempt is cancelled by per-attempt timeout or an in-flight
 * external {@link AbortSignal}. Remaining retries after an external abort throw
 * {@link FetchRetrierAlreadyAbortedError} instead, because the signal stays aborted.
 */
export class FetchRetrierAbortError extends FetchRetrierError {
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
export class FetchRetrierHttpError extends FetchRetrierError {
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
export class FetchRetrierNetworkError extends FetchRetrierError {
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
 * Extends {@link FetchRetrierError}, not {@link TypeError}, so it is not treated as a network
 * failure. Native `fetch` `TypeError` values are retried and surfaced as
 * {@link FetchRetrierNetworkError} after the last attempt.
 */
export class FetchRetrierInvalidOptionsError extends FetchRetrierError {
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
export class FetchRetrierUnreachableError extends FetchRetrierError {
  override readonly name: string = 'FetchRetrierUnreachableError';
  /**
   * @param message - Human-readable reason (default: `'Unreachable'`)
   */
  constructor(message = 'Unreachable') {
    super(message);
    Object.setPrototypeOf(this, FetchRetrierUnreachableError.prototype);
  }
}
