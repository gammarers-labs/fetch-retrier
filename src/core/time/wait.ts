/**
 * Delays execution for the given duration (used between retry attempts).
 *
 * When `signal` is already aborted, or aborts while waiting, the delay ends immediately so the
 * caller can proceed to its next decision. The promise still resolves; the caller decides how
 * cancellation is reported.
 *
 * @param ms - Delay in milliseconds
 * @param signal - Optional {@link AbortSignal} that ends the delay early
 * @returns A promise that resolves after `ms`, or sooner if `signal` aborts
 */
export const wait = (ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
};
