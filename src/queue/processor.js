/**
 * processor.js
 *
 * BullMQ job processor — runs inside worker.js processes.
 *
 * For each job:
 *   1. Extract proxy data and task context from job payload.
 *   2. Call checkProxy() (pure function, no DB required).
 *   3. Append the result to the Redis task store atomically.
 *   4. Return the result (stored by BullMQ for debugging if needed).
 *
 * Errors thrown here mark the BullMQ job as failed, but we intentionally
 * catch all proxy check errors inside checkProxy() so a "dead" proxy
 * produces { online: false } rather than a BullMQ job failure.
 */

'use strict';

const { checkProxy } = require('../checker/proxyChecker');
const { appendTaskResult } = require('../store/taskStore');

/**
 * @param {import('bullmq').Job} job
 */
async function processCheckJob(job) {
  const { task_id, total, index, proxy } = job.data;

  // checkProxy never throws — it returns { online: false, error } on failure
  const checkResult = await checkProxy(proxy);

  const result = {
    index,
    online: checkResult.online,
    exitIP: checkResult.exitIP,
    latencyMs: checkResult.latencyMs,
    error: checkResult.error || null,
  };

  await appendTaskResult(task_id, result, total);

  return result; // stored by BullMQ as job return value
}

module.exports = { processCheckJob };
