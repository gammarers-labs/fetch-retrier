# Fetch Retrier

[![npm version](https://img.shields.io/npm/v/fetch-retrier?style=flat-square)](https://www.npmjs.com/package/fetch-retrier)
[![license](https://img.shields.io/npm/l/fetch-retrier?style=flat-square)](https://www.npmjs.com/package/fetch-retrier)
[![Node.js](https://img.shields.io/node/v/fetch-retrier?style=flat-square)](https://www.npmjs.com/package/fetch-retrier)
[![build](https://img.shields.io/github/actions/workflow/status/gammarers-labs/fetch-retrier/build.yml?branch=main&label=build&style=flat-square)](https://github.com/gammarers-labs/fetch-retrier/actions/workflows/build.yml)

A lightweight wrapper around `fetch` that adds **retries**, **per-attempt timeout**, **Retry-After** support, **full jitter** backoff, and **option validation**. Pass standard `RequestInit` options (`method`, `body`, `credentials`, and more) for POST/PUT APIs and other HTTP calls that may be rate-limited or temporarily unavailable.

## Features

- **Configurable retries** – Set the maximum number of attempts per request (`retries >= 1`).
- **Per-attempt timeout** – Abort each attempt when it exceeds a given duration (`timeoutMs > 0`).
- **Retry-After support** – On HTTP retries, prefers a valid `Retry-After` header (delta-seconds or HTTP-date); falls back to full jitter when absent or invalid.
- **Full jitter backoff** – Exponential backoff with random jitter (AWS-style) for abort/network retries and as the HTTP fallback (`baseBackoffMs >= 0`). Optional `maxBackoffMs` clips the jitter result (`>= 0`); it does not clip a valid `Retry-After`.
- **Option validation** – Invalid numeric options throw `FetchRetrierInvalidOptionsError` at call time.
- **RequestInit forwarding** – Pass `method`, `body`, `credentials`, `redirect`, and other `fetch` options via `init` on every attempt.
- **Header shorthand** – Optional top-level `headers` override `init.headers` when both are set.
- **Default retry policy** – Retries transient HTTP statuses (408, 425, 429, 500, 502, 503, 504) via `defaultShouldRetry` and `DEFAULT_RETRYABLE_HTTP_STATUSES`.
- **Extensible retry predicate** – Compose `defaultShouldRetry` with custom `shouldRetry` logic (receives response body text).
- **External cancellation** – Pass an `AbortSignal` to cancel in-flight requests.
- **Typed errors** – All failures extend `FetchRetrierError`. Subclasses include `FetchRetrierHttpError` (with `status` and `body`), `FetchRetrierNetworkError`, `FetchRetrierAbortError`, and `FetchRetrierInvalidOptionsError`.
- **TypeScript** – Exported types including `RequestOptions` and `FetchInitOptions`.

## How it works

Options are validated, then each attempt sends the same URL and `init`/`headers` with an internal timeout. If `response.ok` is true, that response is returned. Otherwise `shouldRetry` decides whether to wait and try again. HTTP retries prefer a valid `Retry-After` header; abort and network retries use full jitter. After the last attempt, a subclass of `FetchRetrierError` is thrown.

- **Success** – If `response.ok` is true, the response is returned immediately.
- **Package errors** – Failures from this package extend `FetchRetrierError`. Catch the base, or a subclass for a specific case.
- **Invalid options** – If `retries < 1`, `timeoutMs <= 0`, `baseBackoffMs < 0`, or `maxBackoffMs` is set and `< 0`, `FetchRetrierInvalidOptionsError` is thrown before any request is made. This is not a `TypeError`.
- **Retriable failure** – If the response is not OK and `shouldRetry(response, body)` returns true, the client waits and retries until `retries` is exhausted. Wait prefers a valid `Retry-After` header (delta-seconds or HTTP-date); otherwise uses full jitter. On the last attempt, `FetchRetrierHttpError` is thrown (includes `status` and `body`).
- **Non-retriable failure** – If `shouldRetry` returns false, `FetchRetrierHttpError` is thrown immediately with `status` and `body` (e.g. `Non-retriable HTTP error: 404`).
- **Timeout** – If a request exceeds `timeoutMs`, that attempt is aborted and retried with full jitter until `retries` is exhausted. Timeout is per-attempt and does not cancel later attempts. The final failure is `FetchRetrierAbortError`.
- **External abort (in-flight)** – If `signal` is aborted during an attempt, the in-flight request is aborted. On the last attempt, the failure is `FetchRetrierAbortError`. If retries remain, the next attempt sees the still-aborted signal and throws `FetchRetrierAlreadyAbortedError` (no further request is made).
- **Network / TypeError** – Network errors are retried with full jitter; after the last attempt, `FetchRetrierNetworkError` is thrown with the original error as `cause`.
- **Already aborted signal** – If `signal` is already aborted before an attempt starts, `FetchRetrierAlreadyAbortedError` is thrown (no attempt is made).

## Installation

### npm

```bash
npm install fetch-retrier
```

### yarn

```bash
yarn add fetch-retrier
```

### pnpm

```bash
pnpm add fetch-retrier
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
const data = await response.json();
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

`shouldRetry` runs only when `response.ok` is false, after `response.text()`. Extend the default predicate instead of reimplementing the status list:

```typescript
import {
  DEFAULT_RETRYABLE_HTTP_STATUSES,
  defaultShouldRetry,
  fetchRetrier,
} from 'fetch-retrier';

const response = await fetchRetrier('https://api.example.com/data', {
  retries: 5,
  timeoutMs: 10000,
  baseBackoffMs: 500,
  shouldRetry: (res, body) => {
    if (defaultShouldRetry(res, body)) return true;
    if (res.status === 418) return true;
    if (body.includes('"retryable":true')) return true;
    return false;
  },
});

// DEFAULT_RETRYABLE_HTTP_STATUSES is [408, 425, 429, 500, 502, 503, 504]
```

### Handling errors

All failures thrown by `fetchRetrier` extend `FetchRetrierError`. Catch the base for any library
failure, or a subclass for a specific case. `FetchRetrierInvalidOptionsError` does not extend
`TypeError`.

On a non-OK response that is not retried (or after retries are exhausted), `FetchRetrierHttpError`
includes both `status` and the already-read `body`:

```typescript
import {
  fetchRetrier,
  FetchRetrierError,
  FetchRetrierHttpError,
} from 'fetch-retrier';

try {
  await fetchRetrier('https://api.example.com/data', {
    retries: 3,
    timeoutMs: 5000,
    baseBackoffMs: 1000,
  });
} catch (err) {
  if (err instanceof FetchRetrierHttpError) {
    console.error(err.status, err.body);
  }
  if (err instanceof FetchRetrierError) {
    // Any failure from this package.
  }
  throw err;
}
```

### Cancellation with `AbortController`

Timeout abort and external abort are different. Per-attempt timeout retries remaining attempts and
then throws `FetchRetrierAbortError`. An in-flight external abort cancels the current request;
the last attempt throws `FetchRetrierAbortError`, while remaining attempts throw
`FetchRetrierAlreadyAbortedError` because the signal stays aborted.

`FetchRetrierAlreadyAbortedError` extends `FetchRetrierAbortError`, so check the subclass first.

```typescript
import {
  fetchRetrier,
  FetchRetrierAbortError,
  FetchRetrierAlreadyAbortedError,
} from 'fetch-retrier';

const controller = new AbortController();

setTimeout(() => controller.abort(), 250);

try {
  await fetchRetrier('https://api.example.com/data', {
    retries: 3,
    timeoutMs: 5000,
    baseBackoffMs: 250,
    signal: controller.signal,
  });
} catch (err) {
  if (err instanceof FetchRetrierAlreadyAbortedError) {
    // Signal stayed aborted, so a later attempt was not started.
    throw err;
  }
  if (err instanceof FetchRetrierAbortError) {
    // Last attempt was cancelled by timeout or an in-flight external abort.
  }
  throw err;
}
```

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `retries` | `number` | Yes | Maximum number of attempts (including the first request). Must be `>= 1`. |
| `timeoutMs` | `number` | Yes | Timeout in milliseconds for each attempt. Exceeded attempts are aborted and retried. Must be `> 0`. |
| `baseBackoffMs` | `number` | Yes | Base delay in milliseconds for full jitter when `Retry-After` is absent or invalid (also used for abort/network retries). Exponential span is `baseBackoffMs * 2^attempt`, randomized. Must be `>= 0` (`0` skips backoff delay when falling back). |
| `maxBackoffMs` | `number` | No | Optional ceiling in milliseconds applied to the full-jitter result (`Math.min(jitter, maxBackoffMs)`). Does not clip a valid `Retry-After`. Must be `>= 0` when set (`0` skips jitter wait). Omitted means no extra clip. |
| `init` | `FetchInitOptions` | No | `fetch` options forwarded to every attempt: `method`, `body`, `credentials`, `redirect`, `mode`, `cache`, etc. `signal` is reserved for internal timeout and cancellation. |
| `headers` | `Record<string, string>` | No | Headers sent on every attempt. Overrides `init.headers` when both are set. |
| `signal` | `AbortSignal` | No | External abort signal. If already aborted before an attempt, `FetchRetrierAlreadyAbortedError` is thrown. If aborted during an attempt, the in-flight request is aborted: the last attempt fails with `FetchRetrierAbortError`; remaining attempts fail with `FetchRetrierAlreadyAbortedError`. Distinct from `timeoutMs`, which retries remaining attempts and then throws `FetchRetrierAbortError`. |
| `shouldRetry` | `(response: Response, body: string) => boolean` | No | Called after `response.text()` when `response.ok` is false. Return `true` to retry. Default: `defaultShouldRetry` (statuses in `DEFAULT_RETRYABLE_HTTP_STATUSES`: 408, 425, 429, 500, 502, 503, 504). |

### Exported helpers

| Export | Description |
|--------|-------------|
| `defaultShouldRetry` | Default `shouldRetry` predicate; compose with custom logic. |
| `DEFAULT_RETRYABLE_HTTP_STATUSES` | Readonly list of HTTP status codes retried by default. |
| `parseRetryAfterMs` | Parses a `Retry-After` header (delta-seconds or HTTP-date) into a delay in milliseconds. |

## Requirements

- **Node.js** >= 20.0.0
- Uses the global `fetch` (available in Node 18+)

## License

This project is licensed under the Apache-2.0 License.
