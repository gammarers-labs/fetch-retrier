# Fetch Retrier

A lightweight wrapper around `fetch` that adds **retries**, **timeout**, and **full jitter** backoff. Useful for calling HTTP APIs that may be rate-limited (429) or temporarily unavailable (5xx).

[![npm version](https://img.shields.io/npm/v/fetch-retrier.svg)](https://www.npmjs.com/package/fetch-retrier)
[![npm downloads](https://img.shields.io/npm/dm/fetch-retrier.svg)](https://www.npmjs.com/package/fetch-retrier)
[![build](https://github.com/gammarers-labs/fetch-retrier/actions/workflows/build.yml/badge.svg)](https://github.com/gammarers-labs/fetch-retrier/actions/workflows/build.yml)
[![release](https://github.com/gammarers-labs/fetch-retrier/actions/workflows/release.yml/badge.svg)](https://github.com/gammarers-labs/fetch-retrier/actions/workflows/release.yml)

## Features

- **Configurable retries** – Set the maximum number of attempts per request.
- **Per-request timeout** – Abort requests that exceed a given duration.
- **Full jitter backoff** – Exponential backoff with random jitter (AWS-style) between retries.
- **Custom retry predicate** – Control which status codes trigger a retry (default: 429, 500, 502, 503, 504).
- **External cancellation** – Pass an `AbortSignal` to cancel an in-flight request.
- **TypeScript** – Exported types for `RequestOptions` and usage in TS/JS.

## Installation

**npm**

```bash
npm install fetch-retrier
```

**yarn**

```bash
yarn add fetch-retrier
```

## Usage

```typescript
import { fetchRetrier, RequestOptions } from 'fetch-retrier';

const options: RequestOptions = {
  retries: 3,
  timeoutMs: 5000,
  baseBackoffMs: 1000,
  headers: {
    'Authorization': 'Bearer token',
  },
};

const response = await fetchRetrier('https://api.example.com/data', options);

if (response.ok) {
  const data = await response.json();
  // ...
}
```

### Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `retries` | `number` | Yes | Maximum number of attempts (including the first request). |
| `timeoutMs` | `number` | Yes | Timeout in milliseconds for each request. Requests are aborted when this is exceeded. |
| `baseBackoffMs` | `number` | Yes | Base delay in milliseconds for backoff. Delay is capped at `baseBackoffMs * 2^attempt` and randomized (full jitter). |
| `headers` | `Record<string, string>` | No | Headers to send with the request. |
| `signal` | `AbortSignal` | No | Optional external abort signal. If already aborted, `FetchRetrierAlreadyAbortedError` is thrown. If aborted during an attempt, the request is aborted and retried until `retries` is exhausted. |
| `shouldRetry` | `(response: Response, body: string) => boolean` | No | Custom predicate. Return `true` to retry on this response. Default: retry on status 429, 500, 502, 503, 504. |

### Custom retry logic

```typescript
const response = await fetchRetrier('https://api.example.com/data', {
  retries: 5,
  timeoutMs: 10000,
  baseBackoffMs: 500,
  shouldRetry: (res, body) => {
    // Retry on rate limit or server errors, or when body indicates "retry later"
    if ([429, 500, 502, 503].includes(res.status)) return true;
    if (res.status === 200 && body.includes('"retry": true')) return true;
    return false;
  },
});
```

### Cancellation with `AbortController`

```typescript
const controller = new AbortController();

setTimeout(() => controller.abort(), 250);

await fetchRetrier('https://api.example.com/data', {
  retries: 3,
  timeoutMs: 5000,
  baseBackoffMs: 250,
  signal: controller.signal,
});
```

## Retry and error behavior

- **Success** – If `response.ok` is true, the response is returned immediately.
- **Retriable failure** – If the response is not OK and `shouldRetry(response, body)` returns true, the client waits (full jitter backoff) and retries until `retries` is exhausted. On the last attempt, `FetchRetrierHttpError` is thrown (includes `status`).
- **Non-retriable failure** – If `shouldRetry` returns false, `FetchRetrierHttpError` is thrown immediately (e.g. message `Non-retriable HTTP error: 404`).
- **Timeout** – If a request exceeds `timeoutMs`, it is aborted and retried (same backoff) until `retries` is exhausted; the final failure is `FetchRetrierAbortError`.
- **Network/TypeError** – Network errors and related `TypeError`s are retried with backoff; after the last attempt, `FetchRetrierNetworkError` is thrown with the original error as `cause`.
- **Already aborted signal** – If `signal` is already aborted before an attempt starts, `FetchRetrierAlreadyAbortedError` is thrown immediately (no attempt is made).

## Requirements

- **Node.js** >= 20.0.0
- Uses the global `fetch` (available in Node 18+).

## License

This project is licensed under the (Apache-2.0) License.
