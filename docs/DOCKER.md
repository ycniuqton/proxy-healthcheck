# Docker

## Build

```bash
docker build -t proxy-healthcheck .
```

## Env vars (all pass-through)

| Variable | Default | Used by |
|----------|---------|---------|
| `PORT` | `3010` | api |
| `NODE_ENV` | — | api, worker |
| `API_KEY` | — | api, worker |
| `CORS_ORIGIN` | `*` | api |
| `REDIS_HOST` | `127.0.0.1` | api, worker |
| `REDIS_PORT` | `6379` | api, worker |
| `REDIS_PASSWORD` | — | api, worker, redis |
| `PROXY_HEALTHCHECK_TIMEOUT_SECONDS` | `3` | api, worker |
| `WORKER_CONCURRENCY` | `10` | worker |
| `SYNC_MAX_BATCH` | `50` | api |

## Run with docker

**API only** (needs Redis reachable at `REDIS_HOST`/`REDIS_PORT`):

```bash
docker run --rm -p 3010:3010 \
  -e PORT=3010 \
  -e REDIS_HOST=host.docker.internal \
  -e REDIS_PORT=6379 \
  -e REDIS_PASSWORD=yourpass \
  proxy-healthcheck
```

**Worker only** (same image, override command):

```bash
docker run --rm \
  -e REDIS_HOST=host.docker.internal \
  -e REDIS_PORT=6379 \
  -e REDIS_PASSWORD=yourpass \
  -e WORKER_CONCURRENCY=10 \
  proxy-healthcheck node worker.js
```

**Using env file:**

```bash
docker run --rm -p 3010:3010 --env-file .env proxy-healthcheck
docker run --rm --env-file .env -e REDIS_HOST=redis proxy-healthcheck node worker.js
```

## Run with docker-compose

Uses `.env`; all listed env vars are passed through. Override any with `-e` or host env.

```bash
# Start api + worker + redis
docker compose up -d

# Build and start
docker compose up -d --build

# Override env at run
REDIS_PASSWORD=secret PORT=3020 docker compose up -d
```

Compose sets `REDIS_HOST=redis` for api and worker so they use the compose Redis service. To use an external Redis, set `REDIS_HOST` and optionally `REDIS_PORT`/`REDIS_PASSWORD` in `.env` and remove or scale redis to 0.

## Summary

| Goal | Command |
|------|--------|
| Build image | `docker build -t proxy-healthcheck .` |
| API (compose) | `docker compose up -d api` |
| Worker (compose) | `docker compose up -d worker` |
| API + Worker + Redis | `docker compose up -d` |
| API (run) | `docker run -p 3010:3010 --env-file .env proxy-healthcheck` |
| Worker (run) | `docker run --env-file .env proxy-healthcheck node worker.js` |
