/**
 * Delays execution for the given duration (used between retry attempts).
 *
 * @param ms - Delay in milliseconds
 * @returns A promise that resolves after `ms`
 */
export const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
