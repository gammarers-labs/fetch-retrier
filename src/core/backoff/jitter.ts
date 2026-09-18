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
export const fullJitter = (base: number, attempt: number, maxBackoffMs?: number): number => {
  const cap = base * Math.pow(2, attempt);
  const delay = Math.floor(Math.random() * cap);
  if (maxBackoffMs === undefined) {
    return delay;
  }
  return Math.min(delay, maxBackoffMs);
};
