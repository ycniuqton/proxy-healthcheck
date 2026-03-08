'use strict';

require('dotenv').config();

const app = require('./app');

const PORT = parseInt(process.env.PORT || '3010', 10);

const server = app.listen(PORT, () => {
  console.log(`[proxy-healthcheck] API server listening on port ${PORT}`);
  console.log(`  Sync:  POST http://localhost:${PORT}/check/sync`);
  console.log(`  Async: POST http://localhost:${PORT}/check/async`);
  console.log(`  Poll:  GET  http://localhost:${PORT}/task/:id`);
  console.log(`  Queue: GET  http://localhost:${PORT}/health`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    console.log('[proxy-healthcheck] API server stopped');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  server.close(() => {
    console.log('[proxy-healthcheck] API server stopped');
    process.exit(0);
  });
});
