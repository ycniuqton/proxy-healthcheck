/**
 * taskStore.js
 *
 * Redis-backed task state store for async batch healthchecks.
 *
 * Layout per task in Redis:
 *   HASH  task:<id>           → { status, total, done, createdAt }
 *   LIST  task:<id>:results   → [JSON, JSON, ...]   (one entry per proxy checked)
 *
 * All mutations use atomic Redis commands (HINCRBY, RPUSH) so multiple
 * worker processes can safely update the same task concurrently.
 *
 * Task status lifecycle:
 *   pending → processing → completed
 *                        ↘ failed  (if the task itself could not be enqueued)
 */

'use strict';

const { getStoreClient } = require('../redis');

const TASK_TTL_SECONDS = 86400; // results kept for 24 h

/**
 * Create a new task record in Redis.
 * Called by the API server immediately before enqueuing jobs.
 *
 * @param {string} taskId
 * @param {number} total   - number of proxies to check
 */
async function createTask(taskId, total) {
  const redis = getStoreClient();
  const metaKey = `task:${taskId}`;
  const resultsKey = `task:${taskId}:results`;

  await redis.hset(metaKey, {
    status: 'pending',
    total: String(total),
    done: '0',
    createdAt: new Date().toISOString(),
  });
  await redis.expire(metaKey, TASK_TTL_SECONDS);
  // Pre-create key so TTL is set even if no results arrive yet
  await redis.del(resultsKey);
  await redis.expire(resultsKey, TASK_TTL_SECONDS);
}

/**
 * Retrieve full task state including all results collected so far.
 * Returns null if the task does not exist (expired or never created).
 *
 * @param {string} taskId
 * @returns {Promise<object|null>}
 */
async function getTask(taskId) {
  const redis = getStoreClient();
  const metaKey = `task:${taskId}`;
  const resultsKey = `task:${taskId}:results`;

  const meta = await redis.hgetall(metaKey);
  if (!meta || !meta.status) return null;

  const rawResults = await redis.lrange(resultsKey, 0, -1);
  return {
    id: taskId,
    status: meta.status,
    total: parseInt(meta.total, 10),
    done: parseInt(meta.done, 10),
    createdAt: meta.createdAt,
    results: rawResults.map((r) => JSON.parse(r)),
  };
}

/**
 * Append one proxy result to the task and increment the done counter.
 * Atomically transitions status:
 *   pending     → processing   (first result)
 *   processing  → completed    (done === total)
 *
 * Safe for concurrent workers: RPUSH and HINCRBY are both atomic.
 *
 * @param {string} taskId
 * @param {object} result  - { index, online, exitIP, latencyMs, error? }
 * @param {number} total   - total proxies for this task (used for completion check)
 */
async function appendTaskResult(taskId, result, total) {
  const redis = getStoreClient();
  const metaKey = `task:${taskId}`;
  const resultsKey = `task:${taskId}:results`;

  // Append result atomically
  await redis.rpush(resultsKey, JSON.stringify(result));

  // Increment done counter atomically and read back the new value
  const done = await redis.hincrby(metaKey, 'done', 1);

  // Transition status
  if (done === 1) {
    await redis.hset(metaKey, 'status', 'processing');
  }
  if (done >= total) {
    await redis.hset(metaKey, 'status', 'completed');
  }

  // Refresh TTL on every update so active tasks don't expire mid-run
  await redis.expire(metaKey, TASK_TTL_SECONDS);
  await redis.expire(resultsKey, TASK_TTL_SECONDS);
}

/**
 * Mark a task as failed (e.g. could not enqueue jobs).
 *
 * @param {string} taskId
 * @param {string} errorMessage
 */
async function failTask(taskId, errorMessage) {
  const redis = getStoreClient();
  await redis.hset(`task:${taskId}`, {
    status: 'failed',
    errorMessage,
  });
  await redis.expire(`task:${taskId}`, TASK_TTL_SECONDS);
}

module.exports = { createTask, getTask, appendTaskResult, failTask };
