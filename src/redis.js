/**
 * redis.js
 *
 * Redis connection factory.
 *
 * - `redisConfig`     : plain config object used by BullMQ (Queue + Worker).
 *                       BullMQ creates its own internal connections from this.
 * - `getStoreClient()`: singleton ioredis client used by taskStore for
 *                       atomic task state management (HINCRBY, RPUSH, etc.).
 */

'use strict';

const { Redis } = require('ioredis');

/**
 * Connection options shared by BullMQ Queue and Worker.
 * maxRetriesPerRequest: null is required by BullMQ.
 * enableReadyCheck: false avoids startup race conditions.
 */
const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

/** Singleton ioredis client for task store operations. */
let storeClient = null;

function getStoreClient() {
  if (storeClient && storeClient.status !== 'end') return storeClient;
  storeClient = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: false,
  });
  storeClient.on('error', (err) => {
    console.error('[Redis:store]', err.message);
  });
  return storeClient;
}

module.exports = { redisConfig, getStoreClient };
