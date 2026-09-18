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
