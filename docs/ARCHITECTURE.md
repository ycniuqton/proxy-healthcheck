# Architecture

This document describes how the proxy-healthcheck service is structured and how data flows through sync and async modes.

## Overview

The service has two process types:

1. **API server** (`server.js` → `app.js`) — Handles HTTP: sync checks in-process, async checks by enqueuing jobs to Redis and storing task metadata/results in Redis.
2. **Workers** (`worker.js`) — BullMQ workers that pull jobs from Redis, run the proxy check, and append results to the task store.

Sync mode does not require Redis or workers. Async mode requires Redis and at least one worker (multiple workers can run for scaling).

## Components

### Entry points

| File | Role |
|------|------|
| `server.js` | Starts Express on `PORT`, loads `app.js`. |
| `app.js` | Express app: morgan, JSON body (10mb), CORS, mounts `/` → check routes, 404 and error handler. |
| `worker.js` | Creates a BullMQ `Worker` for queue `proxy-healthcheck`, runs `processCheckJob`, concurrency from `WORKER_CONCURRENCY`. |

### Routes (`src/routes/check.js`)

- **GET /health** — Reads queue counts from BullMQ (waiting, active, completed, failed).
- **POST /check/sync** — Validates input; for single proxy calls `checkProxy` once and returns; for batch runs `checkProxy` for each (concurrent), returns `{ results }`. No Redis required.
- **POST /check/async** — Validates `proxies`, creates task in Redis via `createTask`, enqueues one job per proxy via `getQueue().addBulk`, returns `202` with `task_id` and `total`.
- **GET /task/:task_id** — Reads task state and results from Redis via `getTask`, returns 404 if missing/expired.

### Checker (`src/checker/proxyChecker.js`)

- **checkProxy(opts)** — Pure function: builds HTTP or SOCKS5 agent from `host`, `port`, auth, `proxyType`; performs HTTPS GET to ipify (IPv4 or IPv6 URL from `isIPv6`); returns `{ online, exitIP, latencyMs, error? }`. Does not throw; failures return `online: false` and `error`.
- **validateProxy(input)** — Validates/normalizes request body into a canonical proxy object; returns `{ valid, proxy }` or `{ valid, message }`.

### Queue (`src/queue/`)

- **queue.js** — Singleton BullMQ `Queue` named `proxy-healthcheck`, using `redisConfig`. Job payload: `{ task_id, total, index, proxy }`. Options: 1 attempt, keep last 500 completed/failed.
- **processor.js** — `processCheckJob(job)`: reads `task_id`, `total`, `index`, `proxy` from job data; calls `checkProxy(proxy)`; appends result via `appendTaskResult(task_id, result, total)`; returns result (BullMQ stores as return value).

### Task store (`src/store/taskStore.js`)

Redis layout:

- **HASH `task:<id>`** — `status`, `total`, `done`, `createdAt` (and `errorMessage` on failure). TTL 24h, refreshed on updates.
- **LIST `task:<id>:results`** — JSON strings, one per proxy result. TTL 24h.

Operations:

- **createTask(taskId, total)** — Set hash (status=pending, total, done=0, createdAt), set TTL; ensure results list exists with TTL.
- **getTask(taskId)** — HGETALL hash, LRANGE results list; parse JSON; return `{ id, status, total, done, createdAt, results }` or null.
- **appendTaskResult(taskId, result, total)** — RPUSH result JSON; HINCRBY done; if done==1 set status=processing; if done>=total set status=completed; refresh TTLs.
- **failTask(taskId, errorMessage)** — Set status=failed and errorMessage; set TTL.

All mutations use atomic Redis commands so multiple workers can update the same task safely.

### Redis (`src/redis.js`)

- **redisConfig** — Plain object (host, port, password, `maxRetriesPerRequest: null`, `enableReadyCheck: false`) for BullMQ Queue/Worker.
- **getStoreClient()** — Singleton ioredis client for task store (createTask, getTask, appendTaskResult, failTask). Used by API and workers.

## Data flow

### Sync

1. Client → `POST /check/sync` with one proxy or `{ proxies: [...] }`.
2. Route validates all inputs; for each proxy calls `checkProxy(proxy)` (batch: `Promise.all`).
3. Response returns single result or `{ results: [...] }` with `index`, `online`, `exitIP`, `latencyMs`, `error`.

No Redis, no queue, no worker.

### Async

1. Client → `POST /check/async` with `{ proxies: [...] }`.
2. Route validates; creates task with `createTask(task_id, total)` (Redis hash + list).
3. Route enqueues N jobs via `queue.addBulk` (each job: `{ task_id, total, index, proxy }`).
4. Response → `202` with `task_id`, `total`.
5. Workers pull jobs; for each job run `processCheckJob`: `checkProxy(proxy)` → `appendTaskResult(task_id, result, total)`.
6. Client polls `GET /task/:task_id`; `getTask` reads hash + list from Redis and returns status and `results`. When `done === total`, status is `completed` and `results` is complete.

## Task status lifecycle

- **pending** — Task created, jobs enqueued; no result yet.
- **processing** — First result appended (done ≥ 1).
- **completed** — done === total.
- **failed** — Enqueue or task creation failed; set by `failTask`.

## Concurrency and scaling

- Sync: Limited by API process and `SYNC_MAX_BATCH`; all work in one process.
- Async: Add more worker processes (same or different hosts); BullMQ distributes jobs. Increase `WORKER_CONCURRENCY` per process to run more checks in parallel per worker. Task store is shared and safe under concurrent `appendTaskResult` (atomic RPUSH and HINCRBY).

## Dependencies

- **express** — HTTP server and routing.
- **cors** — CORS middleware.
- **morgan** — Request logging.
- **dotenv** — Load `.env`.
- **bullmq** — Queue and worker (Redis-backed).
- **ioredis** — Redis client for task store (BullMQ also uses Redis via its own connection from `redisConfig`).
- **https-proxy-agent** / **socks-proxy-agent** — Proxy agents for HTTPS through HTTP or SOCKS5.
- **uuid** — Generate `task_id` for async tasks.
