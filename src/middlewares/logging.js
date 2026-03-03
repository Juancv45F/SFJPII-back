const { child, generateCorrelationId } = require('../utils/logger');

function requestLogger(req, res, next) {
  const correlationId = req.header('x-correlation-id') || generateCorrelationId();
  res.setHeader('x-correlation-id', correlationId);

  const base = {
    correlationId,
    method: req.method,
    path: req.originalUrl || req.url,
    userId: req.uid,
  };
  req.logger = child(base);

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number((end - start) / 1000000n);
    const status = res.statusCode;

    req.logger.info('request_completed', {
      status: status,
      responseTimeMs: durationMs,
      context: {
        query: req.query,
        params: req.params,
        // Avoid body in GET for brevity; redact handles sensitive keys
        body: req.method === 'GET' ? undefined : req.body,
      },
    });
  });

  next();
}

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  const stack = err.stack;
  const logger = req.logger || child({ method: req.method, path: req.originalUrl || req.url });

  logger.error('exception', {
    status: status,
    context: { stack },
  });

  res.status(status).json({ message });
}

module.exports = {
  requestLogger,
  errorHandler,
};
