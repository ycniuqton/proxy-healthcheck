# proxy-healthcheck

Fast, scalable proxy healthcheck service with **sync** and **async** (Redis queue) modes. Checks HTTP and SOCKS5 proxies by routing requests through them and optionally validating exit IP (IPv4/IPv6).

## Features

- **Sync mode** — Single or small batch checks; response returns immediately with results.
- **Async mode** — Large batches enqueued to Redis; poll by `task_id` for results (scales with workers).
- **Proxy types** — HTTP and SOCKS5, with optional auth (`username`/`password`).
- **Exit IP check** — Optional `expectedIP`; supports IPv4 and IPv6 (`isIPv6`).
- **Horizontal scaling** — Run multiple worker processes; BullMQ ensures each job is processed once.

## Quick start

### Prerequisites

- Node.js 18+
- Redis (for async mode and task storage)

### Install

```bash
npm install
```

### Configure

Copy environment variables (see [Environment variables](#environment-variables)):

```bash
# Optional: copy .env and edit as needed
cp .env .env.local
```

### Run

**1. Start Redis** (if not already running):

```bash
# Example: local Redis on default port 6379
redis-server
```

**2. Start the API server:**

```bash
npm start
# or with auto-reload: npm run dev
```

**3. (Optional) Start workers** (required for async checks):

```bash
npm run worker
# or: npm run worker:dev
```

Default endpoints:

- Sync: `POST http://localhost:3010/check/sync`
- Async: `POST http://localhost:3010/check/async`
- Poll: `GET http://localhost:3010/task/:id`
- Queue status: `GET http://localhost:3010/health`

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3010` | API server port |
| `NODE_ENV` | — | `production` / `development` |
| `API_KEY` | — | If set, all requests require `x-api-key` header |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `REDIS_HOST` | `127.0.0.1` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | — | Redis password (optional) |
| `PROXY_HEALTHCHECK_TIMEOUT_SECONDS` | `3` | Timeout per proxy check (seconds) |
| `WORKER_CONCURRENCY` | `10` | Concurrent checks per worker process |
| `SYNC_MAX_BATCH` | `50` | Max proxies in one sync batch; larger batches use async |

## API summary

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/check/sync` | Check one proxy or a batch (≤ `SYNC_MAX_BATCH`); response includes results immediately. |
| `POST` | `/check/async` | Enqueue a batch of proxies; returns `task_id` for polling. |
| `GET` | `/task/:task_id` | Get task status and results (pending / processing / completed / failed). |
| `GET` | `/health` | Service and queue status (waiting, active, completed, failed counts). |

Proxy object (per item):

- `host` (string) — Proxy host or IP  
- `port` (number) — Proxy port (1–65535)  
- `username` (optional) — Proxy auth username  
- `password` (optional) — Proxy auth password  
- `proxyType` (optional) — `"http"` \| `"socks5"` (default: `"http"`)  
- `expectedIP` (optional) — If set, “online” only when exit IP matches  
- `isIPv6` (optional) — Use IPv6 check URL (default: `false`)  

See [docs/API.md](docs/API.md) for full request/response shapes and examples.

## Project structure

```
proxy-healthcheck/
├── server.js           # HTTP server entry
├── app.js              # Express app, routes, middleware
├── worker.js           # BullMQ worker entry (run 1+ instances)
├── src/
│   ├── routes/check.js # /check/sync, /check/async, /task/:id, /health
│   ├── checker/        # Proxy check logic (HTTP/SOCKS, IP check)
│   │   └── proxyChecker.js
│   ├── queue/          # BullMQ queue + job processor
│   │   ├── queue.js
│   │   └── processor.js
│   ├── store/          # Redis task state (async results)
│   │   └── taskStore.js
│   └── redis.js        # Redis config and store client
├── docs/
│   ├── API.md          # Full API reference
│   └── ARCHITECTURE.md # Design and data flow
└── package.json
```

## Scaling

- **Sync**: Handled in the API process; keep batch size ≤ `SYNC_MAX_BATCH` or use async for large lists.
- **Async**: Add more worker processes (same or different machines) sharing the same Redis. Increase `WORKER_CONCURRENCY` per process for more parallelism. The queue name is `proxy-healthcheck`.

## Docker

All [environment variables](#environment-variables) are read from the container environment, so you can pass them via `.env`, `--env-file`, or `-e KEY=VALUE`.

```bash
# Build image
docker build -t proxy-healthcheck .

# Run API (needs Redis; point REDIS_HOST/REDIS_PORT to your Redis)
docker run --rm -p 3010:3010 \
  --env-file .env \
  -e REDIS_HOST=host.docker.internal \
  proxy-healthcheck

# Run worker (same image)
docker run --rm \
  --env-file .env \
  -e REDIS_HOST=host.docker.internal \
  proxy-healthcheck node worker.js
```

**Docker Compose** (API + worker + Redis):

```bash
docker compose up -d
```

Compose also uses `.env`; override any variable at launch, for example:

```bash
PORT=3020 REDIS_PASSWORD=secret docker compose up -d
```

See `docs/DOCKER.md` for the full env list and additional run options.

## License

See repository for license information.
