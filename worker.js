/**
 * worker.js
 *
 * Standalone worker process — runs BullMQ workers that dequeue and execute
 * proxy check jobs enqueued by the API server.
 *
 * Scale horizontally by running multiple instances of this process:
 *   node worker.js          ← process 1
 *   node worker.js          ← process 2  (on same or different machine)
 *   WORKER_CONCURRENCY=20 node worker.js  ← higher concurrency per process
 *
 * Each worker process handles WORKER_CONCURRENCY jobs in parallel.
 * The BullMQ queue in Redis ensures no job is processed twice.
 */

'use strict';

require('dotenv').config();

const { Worker } = require('bullmq');
const { redisConfig } = require('./src/redis');
const { processCheckJob } = require('./src/queue/processor');
const { QUEUE_NAME } = require('./src/queue/queue');

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '10', 10);

console.log(`[proxy-healthcheck:worker] Starting — queue="${QUEUE_NAME}", concurrency=${CONCURRENCY}`);

const worker = new Worker(QUEUE_NAME, processCheckJob, {
  connection: redisConfig,
  concurrency: CONCURRENCY,
});

worker.on('completed', (job) => {
  const { task_id, index, total } = job.data;
  const { online, latencyMs } = job.returnvalue || {};
  console.log(
    `[worker] job completed  task=${task_id} [${index + 1}/${total}] online=${online} latency=${latencyMs}ms`
  );
});

worker.on('failed', (job, err) => {
  const { task_id, index } = job?.data || {};
  console.error(`[worker] job failed  task=${task_id} index=${index} — ${err.message}`);
});

worker.on('error', (err) => {
  console.error('[worker] worker error:', err.message);
});

// Graceful shutdown
async function shutdown() {
  console.log('[proxy-healthcheck:worker] Shutting down…');
  await worker.close();
  console.log('[proxy-healthcheck:worker] Stopped');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
