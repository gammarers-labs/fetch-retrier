/**
 * Public entry for parsing a `Retry-After` header.
 *
 * The implementation stays in core because HTTP retry delay selection uses the same function.
 */
export { parseRetryAfterMs } from './core/backoff/retry-after';
