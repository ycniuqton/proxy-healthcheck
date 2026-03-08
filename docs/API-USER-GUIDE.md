# Proxy Healthcheck API — User Guide

Base: `http://localhost:3010` (or `PORT`). Optional auth: if `API_KEY` is set, send header `x-api-key: <value>`.

---

## Proxy object (shared)

Used in request bodies. All fields except `host` and `port` are optional.

| Field        | Type    | Required | Default   | Notes                          |
|-------------|---------|----------|-----------|--------------------------------|
| `host`      | string  | Yes      | —         | Proxy host or IP               |
| `port`      | number  | Yes      | —         | 1–65535                        |
| `username`  | string  | No       | `""`      | Proxy auth                     |
| `password`  | string  | No       | `""`      | Proxy auth                     |
| `proxyType` | string  | No       | `"http"`  | `"http"` \| `"socks5"`         |
| `expectedIP`| string  | No       | —         | Online only if exit IP matches |
| `isIPv6`    | boolean | No       | `false`   | Use IPv6 check URL             |

---

## GET /health

**Response 200**

```json
{
  "status": "ok",
  "queue": {
    "waiting": 0,
    "active": 0,
    "completed": 0,
    "failed": 0
  }
}
```

| Field              | Type   |
|--------------------|--------|
| `status`           | string |
| `queue.waiting`    | number |
| `queue.active`     | number |
| `queue.completed`  | number |
| `queue.failed`     | number |

---

## POST /check/sync

**Single proxy:** body = one proxy object (see table above).

**Batch:** body = `{ "proxies": [ proxy, ... ] }`. Max length = `SYNC_MAX_BATCH` (env, default 50).

**Response 200 (single)**

```json
{
  "online": true,
  "exitIP": "203.0.113.1",
  "latencyMs": 120,
  "error": null
}
```

| Field       | Type    | Notes                          |
|-------------|---------|--------------------------------|
| `online`    | boolean |                                |
| `exitIP`    | string \| null | Exit IP; null on failure |
| `latencyMs` | number  |                                |
| `error`     | string \| undefined | Present when online is false |

**Response 200 (batch)**

```json
{
  "results": [
    { "index": 0, "online": true, "exitIP": "203.0.113.1", "latencyMs": 120 },
    { "index": 1, "online": false, "exitIP": null, "latencyMs": 3000, "error": "Timeout" }
  ]
}
```

| Field           | Type     |
|-----------------|----------|
| `results`       | array    |
| `results[].index` | number  |
| `results[].online` | boolean |
| `results[].exitIP` | string \| null |
| `results[].latencyMs` | number |
| `results[].error` | string \| undefined |

**Errors:** 400 (validation: empty proxies, over limit, invalid host/port/proxyType).

---

## POST /check/async

Body: `{ "proxies": [ proxy, ... ] }`. Non-empty array required. No single-proxy shorthand.

**Response 202**

```json
{
  "task_id": "uuid",
  "total": 5
}
```

| Field     | Type   |
|-----------|--------|
| `task_id` | string |
| `total`   | number |

**Errors:** 400 (missing/empty proxies, validation). 500 (enqueue failed).

---

## GET /task/:task_id

Poll async task. Replace `:task_id` with value from POST /check/async.

**Response 200**

```json
{
  "id": "uuid",
  "status": "completed",
  "total": 5,
  "done": 5,
  "createdAt": "2025-02-28T12:00:00.000Z",
  "results": [
    { "index": 0, "online": true, "exitIP": "203.0.113.1", "latencyMs": 120 },
    { "index": 1, "online": false, "exitIP": null, "latencyMs": 3000, "error": "Timeout" }
  ]
}
```

| Field        | Type   | Notes                                      |
|--------------|--------|--------------------------------------------|
| `id`         | string | Same as task_id                            |
| `status`     | string | `"pending"` \| `"processing"` \| `"completed"` \| `"failed"` |
| `total`      | number | Total proxies in task                      |
| `done`       | number | Results received so far                    |
| `createdAt`  | string | ISO 8601                                   |
| `results`    | array  | Same item shape as sync batch result       |

**Response 404:** Task not found or expired.

---

## Summary

| Method | Path            | Body / params        | Use case              |
|--------|-----------------|----------------------|------------------------|
| GET    | /health         | —                    | Service + queue status |
| POST   | /check/sync     | proxy or `{proxies}` | Wait for result        |
| POST   | /check/async    | `{proxies}`          | Enqueue, poll by task_id |
| GET    | /task/:task_id  | —                    | Poll async result      |
