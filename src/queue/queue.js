/**
 * queue.js
 *
 * BullMQ Queue singleton used by the API server to enqueue proxy check jobs.
 * Workers (worker.js) connect to the same Redis queue and consume these jobs.
 *
 * Job payload shape:
 * {
 *   task_id : string   - ID of the parent async task
 *   total   : number   - total proxies in this task (for completion detection)
 *   index   : number   - 0-based position of this proxy in the original list
 *   proxy   : {
 *     host, port, username, password, proxyType, expectedIP, isIPv6
 *   }
 * }
 */

'use strict';

const { Queue } = require('bullmq');
const { redisConfig } = require('../redis');

const QUEUE_NAME = 'proxy-healthcheck';

let _queue = null;

function getQueue() {
  if (_queue) return _queue;
  _queue = new Queue(QUEUE_NAME, {
    connection: redisConfig,
    defaultJobOptions: {
      attempts: 1,           // No retries — a failed check is a result, not a crash
      removeOnComplete: 500, // Keep last 500 completed jobs for debugging
      removeOnFail: 500,
    },
  });
  return _queue;
}

module.exports = { getQueue, QUEUE_NAME };
