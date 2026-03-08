# API Reference

Base URL: `http://localhost:3010` (or your `PORT`).

Optional: if `API_KEY` is set, send `x-api-key: <API_KEY>` on every request.

---

## GET /health

Returns service and queue status.

**Response** `200 OK`:

```json
{
  "status": "ok",
  "queue": {
    "waiting": 0,
    "active": 2,
    "completed": 150,
    "failed": 0
  }
}
```

- `queue` counts are from the BullMQ queue `proxy-healthcheck` (waiting = pending jobs, etc.).

---

## POST /check/sync

Run healthchecks and wait for the response. Use for a **single proxy** or a **batch** of up to `SYNC_MAX_BATCH` (default 50) proxies.

### Single proxy

**Request body:**

```json
{
  "host": "proxy.example.com",
  "port": 8080,
  "username": "user",
  "password": "pass",
  "proxyType": "http",
  "expectedIP": "203.0.113.1",
  "isIPv6": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `host` | string | Yes | Proxy host or IP |
| `port` | number | Yes | 1–65535 |
| `username` | string | No | Proxy auth username |
| `password` | string | No | Proxy auth password |
| `proxyType` | string | No | `"http"` or `"socks5"` (default: `"http"`) |
| `expectedIP` | string | No | If set, proxy is "online" only when exit IP equals this |
| `isIPv6` | boolean | No | Use IPv6 check URL (default: `false`) |

**Response** `200 OK` (single):

```json
{
  "online": true,
  "exitIP": "203.0.113.1",
  "latencyMs": 420,
  "error": null
}
```

- `online`: `true` if proxy worked and (if `expectedIP` set) exit IP matched.
- `exitIP`: IP returned by the check service via the proxy; `null` on failure.
- `latencyMs`: Round-trip time in milliseconds.
- `error`: Short error message when `online` is `false` (e.g. timeout, connection refused).

### Batch (sync)

**Request body:**

```json
{
  "proxies": [
    { "host": "proxy1.example.com", "port": 8080 },
    { "host": "proxy2.example.com", "port": 3128, "proxyType": "http" }
  ]
}
```

- `proxies`: array of proxy objects (same shape as single proxy above).
- Batch size must be ≤ `SYNC_MAX_BATCH` (default 50). For larger batches use `POST /check/async`.

**Response** `200 OK` (batch):

```json
{
  "results": [
    { "index": 0, "online": true, "exitIP": "203.0.113.1", "latencyMs": 400, "error": null },
    { "index": 1, "online": false, "exitIP": null, "latencyMs": 3000, "error": "Timeout" }
  ]
}
```

- `index`: 0-based index in the request `proxies` array.

**Errors:**

- `400`: Empty `proxies`, invalid proxy field (e.g. bad port), or batch size &gt; `SYNC_MAX_BATCH`.
- `401`: Invalid or missing `x-api-key` when `API_KEY` is set.

---

## POST /check/async

Enqueue a batch of proxy checks. The response returns immediately with a `task_id`; use `GET /task/:task_id` to poll for results.

**Request body:**

```json
{
  "proxies": [
    { "host": "proxy1.example.com", "port": 8080 },
    { "host": "proxy2.example.com", "port": 3128 }
  ]
}
```

- `proxies`: non-empty array of proxy objects (same as in sync).

**Response** `202 Accepted`:

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "total": 2
}
```

- `task_id`: Use in `GET /task/:task_id` to fetch status and results.
- `total`: Number of proxies in the task.

**Errors:**

- `400`: Missing or empty `proxies`, or invalid proxy at some index.
- `401`: Invalid or missing `x-api-key` when `API_KEY` is set.
- `500`: Enqueue failed (e.g. Redis down); task is marked failed, no results.

---

## GET /task/:task_id

Return status and results for an async task.

**Parameters:**

- `task_id`: UUID returned from `POST /check/async`.

**Response** `200 OK`:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "total": 2,
  "done": 2,
  "createdAt": "2025-02-28T12:00:00.000Z",
  "results": [
    { "index": 0, "online": true, "exitIP": "203.0.113.1", "latencyMs": 400, "error": null },
    { "index": 1, "online": false, "exitIP": null, "latencyMs": 3000, "error": "Timeout" }
  ]
}
```

| Field | Description |
|-------|-------------|
| `id` | Same as `task_id` |
| `status` | `"pending"` \| `"processing"` \| `"completed"` \| `"failed"` |
| `total` | Number of proxies in the task |
| `done` | Number of results received so far |
| `createdAt` | Task creation time (ISO 8601) |
| `results` | Array of result objects (same shape as sync batch items); order may differ from request, use `index` to match |

- **pending**: Task created, jobs may not be picked yet.
- **processing**: At least one result received; more may still be in progress.
- **completed**: All `total` results are in `results`.
- **failed**: Task creation/enqueue failed; see store for `errorMessage` if exposed.

**Response** `404 Not Found`:

Task not found or expired (e.g. TTL 24h). Body: `{ "statusCode": 404, "message": "Task not found or expired" }`.

---

## Result object (all check endpoints)

Each result has the form:

```ts
{
  index?: number;   // only in batch/task results
  online: boolean;
  exitIP: string | null;
  latencyMs: number;
  error: string | null;
}
```

- `online`: Proxy was reachable and (if `expectedIP` was set) exit IP matched.
- `exitIP`: IP seen through the proxy; `null` on failure.
- `latencyMs`: Time in ms for the check.
- `error`: Error message when check failed; `null` on success.
