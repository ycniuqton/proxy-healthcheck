'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const checkRoutes = require('./src/routes/check');

const app = express();

app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' })); // allow large batches
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

app.use('/', checkRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ statusCode: 404, message: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  if (process.env.NODE_ENV !== 'production') console.error(err);
  const code = err.statusCode || 500;
  res.status(code).json({ statusCode: code, message: err.message || 'Internal server error' });
});

module.exports = app;
