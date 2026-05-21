# Fetch Retrier

A lightweight wrapper around `fetch` that adds **retries**, **per-attempt timeout**, and **full jitter** backoff. Pass standard `RequestInit` options (`method`, `body`, `credentials`, and more) for POST/PUT APIs and other HTTP calls that may be rate-limited (429) or temporarily unavailable (5xx).

[![npm version](https://img.shields.io/npm/v/fetch-retrier.svg)](https://www.npmjs.com/package/fetch-retrier)
[![npm downloads](https://img.shields.io/npm/dm/fetch-retrier.svg)](https://www.npmjs.com/package/fetch-retrier)
[![build](https://github.com/gammarers-labs/fetch-retrier/actions/workflows/build.yml/badge.svg)](https://github.com/gammarers-labs/fetch-retrier/actions/workflows/build.yml)
[![release](https://github.com/gammarers-labs/fetch-retrier/actions/workflows/release.yml/badge.svg)](https://github.com/gammarers-labs/fetch-retrier/actions/workflows/release.yml)

## Features

- **Configurable retries** – Set the maximum number of attempts per request.
- **Per-attempt timeout** – Abort each attempt when it exceeds a given duration.
- **Full jitter backoff** – Exponential backoff with random jitter (AWS-style) between retries.
- **RequestInit forwarding** – Pass `method`, `body`, `credentials`, `redirect`, and other `fetch` options via `init` on every attempt.
- **Header shorthand** – Optional top-level `headers` override `init.headers` when both are set.
- **Custom retry predicate** – Control which responses trigger a retry (default: 429, 500, 502, 503, 504).
- **External cancellation** – Pass an `AbortSignal` to cancel in-flight requests.
- **Typed errors** – `FetchRetrierHttpError`, `FetchRetrierNetworkError`, `FetchRetrierAbortError`, and related classes.
- **TypeScript** – Exported types including `RequestOptions` and `FetchInitOptions`.

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

### GET request

```typescript
import { fetchRetrier, RequestOptions } from 'fetch-retrier';

const options: RequestOptions = {
  retries: 3,
  timeoutMs: 5000,
  baseBackoffMs: 1000,
  headers: {
    Authorization: 'Bearer token',
  },
};

const response = await fetchRetrier('https://api.example.com/data', options);

if (response.ok) {
  const data = await response.json();
}
```

### POST with JSON body (`init`)

```typescript
import { fetchRetrier } from 'fetch-retrier';

const response = await fetchRetrier('https://api.example.com/items', {
  retries: 3,
  timeoutMs: 5000,
  baseBackoffMs: 1000,
  init: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'example' }),
    credentials: 'include',
  },
});

const item = await response.json();
```

The same `init` (including `body`) is applied on every retry attempt. Per-attempt `signal` and timeout are managed internally.

### Custom retry logic

```typescript
const response = await fetchRetrier('https://api.example.com/data', {
  retries: 5,
  timeoutMs: 10000,
  baseBackoffMs: 500,
  shouldRetry: (res, body) => {
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

### Retry and error behavior

- **Success** – If `response.ok` is true, the response is returned immediately.
- **Retriable failure** – If the response is not OK and `shouldRetry(response, body)` returns true, the client waits (full jitter backoff) and retries until `retries` is exhausted. On the last attempt, `FetchRetrierHttpError` is thrown (includes `status`).
- **Non-retriable failure** – If `shouldRetry` returns false, `FetchRetrierHttpError` is thrown immediately (e.g. `Non-retriable HTTP error: 404`).
- **Timeout** – If a request exceeds `timeoutMs`, it is aborted and retried until `retries` is exhausted; the final failure is `FetchRetrierAbortError`.
- **Network / TypeError** – Network errors are retried with backoff; after the last attempt, `FetchRetrierNetworkError` is thrown with the original error as `cause`.
- **Already aborted signal** – If `signal` is already aborted before an attempt starts, `FetchRetrierAlreadyAbortedError` is thrown (no attempt is made).

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `retries` | `number` | Yes | Maximum number of attempts (including the first request). |
| `timeoutMs` | `number` | Yes | Timeout in milliseconds for each attempt. Exceeded attempts are aborted and retried. |
| `baseBackoffMs` | `number` | Yes | Base delay in milliseconds for backoff. Delay is capped at `baseBackoffMs * 2^attempt` and randomized (full jitter). |
| `init` | `FetchInitOptions` | No | `fetch` options forwarded to every attempt: `method`, `body`, `credentials`, `redirect`, `mode`, `cache`, etc. `signal` is reserved for internal timeout and cancellation. |
| `headers` | `Record<string, string>` | No | Headers sent on every attempt. Overrides `init.headers` when both are set. |
| `signal` | `AbortSignal` | No | External abort signal. If already aborted, `FetchRetrierAlreadyAbortedError` is thrown. If aborted during an attempt, the request is aborted and retried until `retries` is exhausted. |
| `shouldRetry` | `(response: Response, body: string) => boolean` | No | Called after `response.text()` when `response.ok` is false. Return `true` to retry. Default: 429, 500, 502, 503, 504. |

## Requirements

- **Node.js** >= 20.0.0
- Uses the global `fetch` (available in Node 18+)

## License

This project is licensed under the (Apache-2.0) License.
