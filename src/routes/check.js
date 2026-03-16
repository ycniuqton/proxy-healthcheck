/**
 * routes/check.js
 *
 * API routes for proxy healthchecks.
 *
 * ─────────────────────────────────────────────────────────────
 * SYNC  — wait in response, result returned immediately
 * ─────────────────────────────────────────────────────────────
 *
 *   POST /check/sync
 *     Single proxy:
 *       Body: { host, port, username?, password?, proxyType?, expectedIP?, isIPv6? }
 *       Response 200: { online, exitIP, latencyMs, error? }
 *
 *     Batch (up to SYNC_MAX_BATCH):
 *       Body: { proxies: [ { host, port, ... }, ... ] }
 *       Response 200: { results: [ { index, online, exitIP, latencyMs, error? } ] }
 *
 * ─────────────────────────────────────────────────────────────
 * ASYNC — enqueue, returns task_id for polling
 * ─────────────────────────────────────────────────────────────
 *
 *   POST /check/async
 *     Body: { proxies: [ { host, port, ... }, ... ] }
 *     Response 202: { task_id, total }
 *
 *   GET /task/:task_id
 *     Response 200: {
 *       id, status, total, done, createdAt,
 *       results: [ { index, online, exitIP, latencyMs, error? } ]
 *     }
 *     status values: "pending" | "processing" | "completed" | "failed"
 *
 * ─────────────────────────────────────────────────────────────
 * HEALTH
 * ─────────────────────────────────────────────────────────────
 *
 *   GET /health
 *     Response 200: { status: "ok", queue: { waiting, active, completed, failed } }
 */

'use strict';

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { checkProxy, validateProxy } = require('../checker/proxyChecker');
const { createTask, getTask, failTask } = require('../store/taskStore');
const { getQueue } = require('../queue/queue');

const router = Router();

// Maximum number of proxies allowed in a single sync batch request.
// Larger batches should use async mode.
const SYNC_MAX_BATCH = parseInt(process.env.SYNC_MAX_BATCH || '50', 10);

// ─── Optional API-key auth ────────────────────────────────────────────────────
function apiKeyMiddleware(req, res, next) {
  const requiredKey = process.env.API_KEY;
  if (!requiredKey) return next(); // auth disabled when API_KEY is not set
  const provided = req.headers['x-api-key'];
  if (provided !== requiredKey) {
    return res.status(401).json({ statusCode: 401, message: 'Invalid or missing x-api-key' });
  }
  next();
}

router.use(apiKeyMiddleware);

// ─── GET /docs.md (API docs index) ────────────────────────────────────────────
router.get('/docs.md', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.type('text/markdown').send(
    [
      '# API docs index',
      '',
      'Short index of available endpoint docs. For full details, open each `.md` URL.',
      '',
      '- **GET /health.md** — Health and queue status response shape.',
      '- **GET /check/sync.md** — How to call `POST /check/sync` (single + batch), request/response schema.',
      '- **GET /check/async.md** — How to call `POST /check/async`, request body and `202` response.',
      '- **GET /task/{task_id}.md** — Async task result format (statuses, results items).',
      '',
      'Base URL example:',
      '',
      `- \`${base}/health.md\``,
      `- \`${base}/check/sync.md\``,
      `- \`${base}/check/async.md\``,
      `- \`${base}/task/<task_id>.md\``,
      '',
    ].join('\n')
  );
});

// ─── GET /health ──────────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  try {
    const queue = getQueue();
    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
    ]);
    res.json({
      status: 'ok',
      queue: { waiting, active, completed, failed },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─── GET /health.md (self-doc) ───────────────────────────────────────────────
router.get('/health.md', (req, res) => {
  res.type('text/markdown').send(
    [
      '# GET /health',
      '',
      '- **Method**: GET',
      '- **Auth**: optional `x-api-key` when `API_KEY` is set',
      '',
      '**Response 200**',
      '',
      '```json',
      '{',
      '  "status": "ok",',
      '  "queue": {',
      '    "waiting": 0,',
      '    "active": 0,',
      '    "completed": 0,',
      '    "failed": 0',
      '  }',
      '}',
      '```',
      '',
      '- **status**: service status string.',
      '- **queue.waiting/active/completed/failed**: BullMQ job counts.',
      '',
    ].join('\n')
  );
});

// ─── POST /check/sync ─────────────────────────────────────────────────────────
router.post('/check/sync', async (req, res) => {
  const body = req.body;

  // ── Batch mode: { proxies: [...] } ──
  if (Array.isArray(body.proxies)) {
    if (body.proxies.length === 0) {
      return res.status(400).json({ statusCode: 400, message: '"proxies" array must not be empty' });
    }
    if (body.proxies.length > SYNC_MAX_BATCH) {
      return res.status(400).json({
        statusCode: 400,
        message: `Sync batch limit is ${SYNC_MAX_BATCH} proxies. Use POST /check/async for larger batches.`,
      });
    }

    // Validate all proxies before checking any
    const validated = [];
    for (let i = 0; i < body.proxies.length; i++) {
      const v = validateProxy(body.proxies[i]);
      if (!v.valid) {
        return res.status(400).json({
          statusCode: 400,
          message: `proxies[${i}]: ${v.message}`,
        });
      }
      validated.push(v.proxy);
    }

    // Run all checks concurrently
    const checks = validated.map((proxy, index) =>
      checkProxy(proxy).then((r) => ({ index, ...r }))
    );
    const results = await Promise.all(checks);
    return res.json({ results });
  }

  // ── Single mode: { host, port, ... } ──
  const v = validateProxy(body);
  if (!v.valid) {
    return res.status(400).json({ statusCode: 400, message: v.message });
  }
  const result = await checkProxy(v.proxy);
  return res.json(result);
});

// ─── GET /check/sync.md (self-doc) ───────────────────────────────────────────
router.get('/check/sync.md', (req, res) => {
  res.type('text/markdown').send(
    [
      '# POST /check/sync',
      '',
      '- **Method**: POST',
      '- **Auth**: optional `x-api-key` when `API_KEY` is set',
      '',
      'Single proxy body:',
      '',
      '```json',
      '{',
      '  "host": "proxy.example.com",',
      '  "port": 8080,',
      '  "username": "user",',
      '  "password": "pass",',
      '  "proxyType": "http",',
      '  "expectedIP": "203.0.113.1",',
      '  "isIPv6": false',
      '}',
      '```',
      '',
      'Batch body (≤ `SYNC_MAX_BATCH`):',
      '',
      '```json',
      '{',
      '  "proxies": [ { "host": "...", "port": 8080, "proxyType": "http" } ]',
      '}',
      '```',
      '',
      '**Response 200 (single)**',
      '',
      '```json',
      '{',
      '  "online": true,',
      '  "exitIP": "203.0.113.1",',
      '  "latencyMs": 120,',
      '  "error": null',
      '}',
      '```',
      '',
      '- **online**: boolean (false if response is not a valid IPv4/IPv6 or check failed).',
      '- **exitIP**: detected exit IP string or raw non-IP response for debugging.',
      '- **latencyMs**: check time in milliseconds.',
      '- **error**: short error message when `online` is false.',
      '',
    ].join('\n')
  );
});

// ─── POST /check/async ────────────────────────────────────────────────────────
router.post('/check/async', async (req, res) => {
  const { proxies } = req.body;

  if (!Array.isArray(proxies) || proxies.length === 0) {
    return res.status(400).json({ statusCode: 400, message: '"proxies" must be a non-empty array' });
  }

  // Validate all proxies upfront — fail fast before creating any task
  const validated = [];
  for (let i = 0; i < proxies.length; i++) {
    const v = validateProxy(proxies[i]);
    if (!v.valid) {
      return res.status(400).json({
        statusCode: 400,
        message: `proxies[${i}]: ${v.message}`,
      });
    }
    validated.push(v.proxy);
  }

  const task_id = uuidv4();
  const total = validated.length;

  // Create task record in Redis before enqueuing so polling can start immediately
  await createTask(task_id, total);

  try {
    const queue = getQueue();
    const jobs = validated.map((proxy, index) => ({
      name: 'check',
      data: { task_id, total, index, proxy },
    }));
    await queue.addBulk(jobs);
  } catch (err) {
    await failTask(task_id, err.message);
    return res.status(500).json({ statusCode: 500, message: 'Failed to enqueue jobs: ' + err.message });
  }

  return res.status(202).json({ task_id, total });
});

// ─── GET /check/async.md (self-doc) ──────────────────────────────────────────
router.get('/check/async.md', (req, res) => {
  res.type('text/markdown').send(
    [
      '# POST /check/async',
      '',
      '- **Method**: POST',
      '- **Auth**: optional `x-api-key` when `API_KEY` is set',
      '',
      'Body (non-empty batch):',
      '',
      '```json',
      '{',
      '  "proxies": [',
      '    {',
      '      "host": "proxy.example.com",',
      '      "port": 8080,',
      '      "username": "user",',
      '      "password": "pass",',
      '      "proxyType": "http",',
      '      "expectedIP": "203.0.113.1",',
      '      "isIPv6": false',
      '    }',
      '  ]',
      '}',
      '```',
      '',
      '**Response 202**',
      '',
      '```json',
      '{',
      '  "task_id": "uuid-string",',
      '  "total": 1',
      '}',
      '```',
      '',
      '- Use `GET /task/{task_id}` or `/task/{task_id}.md` for results.',
      '',
    ].join('\n')
  );
});

// ─── GET /task/:task_id ───────────────────────────────────────────────────────
router.get('/task/:task_id', async (req, res) => {
  const { task_id } = req.params;
  const task = await getTask(task_id);
  if (!task) {
    return res.status(404).json({ statusCode: 404, message: 'Task not found or expired' });
  }
  return res.json(task);
});

// ─── GET /task/:task_id.md (self-doc for async result shape) ─────────────────
router.get('/task/:task_id.md', async (req, res) => {
  const { task_id } = req.params;
  res.type('text/markdown').send(
    [
      `# GET /task/${task_id}`,
      '',
      '- **Method**: GET',
      '- **Auth**: optional `x-api-key` when `API_KEY` is set',
      '',
      '**Response 200 (example)**',
      '',
      '```json',
      '{',
      '  "id": "uuid-string",',
      '  "status": "completed",',
      '  "total": 2,',
      '  "done": 2,',
      '  "createdAt": "2026-03-16T19:00:00.000Z",',
      '  "results": [',
      '    {',
      '      "index": 0,',
      '      "online": true,',
      '      "exitIP": "203.0.113.1",',
      '      "latencyMs": 120,',
      '      "error": null',
      '    },',
      '    {',
      '      "index": 1,',
      '      "online": false,',
      '      "exitIP": "<html>...</html>",',
      '      "latencyMs": 30,',
      '      "error": "Non-IP response from proxy"',
      '    }',
      '  ]',
      '}',
      '```',
      '',
      '- **status**: `"pending"` \\| `"processing"` \\| `"completed"` \\| `"failed"`.',
      '- **results[index].online**: false if check failed or response was not a valid IPv4/IPv6.',
      '',
    ].join('\n')
  );
});

module.exports = router;
