/**
 * request Options
 */
export interface RequestOptions {
  headers?: Record<string, string>;
  retries: number;
  timeoutMs: number;
  baseBackoffMs: number;
  /**
   * Custom predicate: return true to retry on this response.
   * Default: retry on 429, 500, 502, 503, 504
   */
  shouldRetry?: (response: Response, body: string) => boolean;
}

const defaultShouldRetry = (res: Response): boolean => {
  return [429, 500, 502, 503, 504].includes(res.status);
};

/**
 * retry + timeout + Full Jitter
 * @param url - The URL to fetch
 * @param options - The options for the fetch
 * @returns The response
 */
export const fetchRetrier = async (url: string, options: RequestOptions): Promise<Response> => {
  const { headers, retries, timeoutMs, baseBackoffMs, shouldRetry = defaultShouldRetry } = options;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.ok) {
        return res;
      }

      const text = await res.text();
      const isContinue = shouldRetry(res, text);

      if (isContinue) {
        if (attempt === retries) {
          throw new Error(`HTTP ${res.status}`);
        }
        await wait(fullJitter(baseBackoffMs, attempt));
      } else {
        throw new Error(`Non-retriable HTTP error: ${res.status}`);
      }
    } catch (err: unknown) {
      clearTimeout(timer);

      if (err instanceof Error && err.name === 'AbortError') {
        if (attempt === retries) throw err;
        await wait(fullJitter(baseBackoffMs, attempt));
        continue;
      }

      if (err instanceof TypeError) {
        if (attempt === retries) throw err;
        await wait(fullJitter(baseBackoffMs, attempt));
        continue;
      }

      throw err;
    }
  }

  throw new Error('Unreachable');
};

const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * AWS recommended Full Jitter
 * @param base - The base time in milliseconds
 * @param attempt - The attempt number
 * @returns The time to wait in milliseconds
 */
const fullJitter = (base: number, attempt: number): number => {
  const cap = base * Math.pow(2, attempt);
  return Math.floor(Math.random() * cap);
};
