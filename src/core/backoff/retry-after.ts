import { fullJitter } from './jitter';

/**
 * Options for {@link parseRetryAfterMs}.
 *
 * Pass this object as the second argument. A numeric second argument is still accepted.
 */
export interface ParseRetryAfterOptions {
  /**
   * Current time in milliseconds.
   * When omitted, {@link parseRetryAfterMs} uses `Date.now()`.
   */
  nowMs?: number;
}

/**
 * Resolves the clock for {@link parseRetryAfterMs}.
 *
 * A number is the positional current time. An options object reads `nowMs`.
 * Either form falls back to `Date.now()` when the clock is omitted.
 */
const currentTimeMs = (nowMsOrOptions?: number | ParseRetryAfterOptions): number => {
  if (typeof nowMsOrOptions === 'number') {
    return nowMsOrOptions;
  }
  return nowMsOrOptions?.nowMs ?? Date.now();
};

/**
 * Parses a `Retry-After` header value into a delay in milliseconds.
 *
 * Supports RFC 7231 forms: non-negative integer delta-seconds, or an HTTP-date. Empty values,
 * non-integer numerics (e.g. floats or negatives), unparsable dates, and delta-seconds that
 * overflow to a non-finite delay yield `undefined` so callers can fall back to full jitter.
 * An HTTP-date in the past yields `0`.
 *
 * Prefer `{ nowMs }` from {@link ParseRetryAfterOptions}. A numeric second argument is still accepted.
 *
 * @param value - Raw `Retry-After` header value
 * @param nowMsOrOptions - `{ nowMs }` (preferred) or a current time in milliseconds. Defaults to `Date.now()`
 * @returns Delay in milliseconds, or `undefined` when the value cannot be parsed
 */
export const parseRetryAfterMs = (
  value: string,
  nowMsOrOptions?: number | ParseRetryAfterOptions,
): number | undefined => {
  const nowMs = currentTimeMs(nowMsOrOptions);
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }

  if (/^\d+$/.test(trimmed)) {
    // A long digit string can overflow to Infinity. That delay cannot be waited on safely.
    const delayMs = Number.parseInt(trimmed, 10) * 1000;
    if (!Number.isFinite(delayMs)) {
      return undefined;
    }
    return delayMs;
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
 * A finite delay is returned as-is when `maxRetryAfterMs` is omitted, and clipped with
 * `Math.min(delay, maxRetryAfterMs)` when that ceiling is set. Abort and network retries do not
 * use this helper.
 *
 * @param response - Non-OK response from the current attempt
 * @param baseBackoffMs - Base backoff passed to {@link fullJitter} when falling back
 * @param attempt - 1-based attempt index
 * @param maxBackoffMs - Optional ceiling applied only to the jitter fallback
 * @param maxRetryAfterMs - Optional ceiling applied only to a finite `Retry-After` delay
 * @param nowMs - Current time in milliseconds (injectable for tests)
 * @returns Wait duration in milliseconds before the next attempt
 */
export const resolveRetryDelayMs = (
  response: Response,
  baseBackoffMs: number,
  attempt: number,
  maxBackoffMs?: number,
  maxRetryAfterMs?: number,
  nowMs: number = Date.now(),
): number => {
  const header = response.headers?.get('Retry-After');
  if (header == null) {
    return fullJitter(baseBackoffMs, attempt, maxBackoffMs);
  }

  const fromHeader = parseRetryAfterMs(header, { nowMs });
  if (fromHeader === undefined) {
    return fullJitter(baseBackoffMs, attempt, maxBackoffMs);
  }
  if (maxRetryAfterMs === undefined) {
    return fromHeader;
  }

  return Math.min(fromHeader, maxRetryAfterMs);
};
