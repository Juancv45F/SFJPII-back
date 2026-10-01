const axios = require('axios');
const { child } = require('../utils/logger');

const DEFAULT_INTERVAL_MS = 13 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;
const logger = child({ component: 'service_keep_alive' });

function isEnabled() {
  const configured = process.env.KEEP_ALIVE_ENABLED;
  if (configured !== undefined) {
    return String(configured).toLowerCase() === 'true';
  }

  return Boolean(
    process.env.RENDER ||
    process.env.RENDER_SERVICE_ID ||
    process.env.RENDER_EXTERNAL_URL
  );
}

function healthUrl(baseUrl) {
  const normalized = String(baseUrl || '').trim().replace(/\/+$/, '');
  return normalized ? `${normalized}/health` : '';
}

async function pingService(url) {
  if (!url) return;

  const startedAt = Date.now();
  try {
    const response = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 2,
      headers: { 'User-Agent': 'SFJPII-Backend-KeepAlive/1.0' }
    });
    logger.info('keep_alive_ping_ok', {
      status: response.status,
      responseTimeMs: Date.now() - startedAt,
      context: { target: url }
    });
  } catch (error) {
    logger.warn('keep_alive_ping_failed', {
      status: error?.response?.status || null,
      responseTimeMs: Date.now() - startedAt,
      context: { target: url, code: error?.code, message: error?.message }
    });
  }
}

function startServiceKeepAlive() {
  if (!isEnabled()) {
    logger.info('keep_alive_disabled');
    return null;
  }

  const target = healthUrl(
    process.env.SFJPII_AI_URL || 'https://sfjpii-ai.onrender.com'
  );
  const configuredInterval = Number(process.env.KEEP_ALIVE_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval >= 60_000
    ? configuredInterval
    : DEFAULT_INTERVAL_MS;

  void pingService(target);
  const timer = setInterval(() => void pingService(target), intervalMs);
  timer.unref?.();

  logger.info('keep_alive_started', {
    context: { target, intervalMs }
  });
  return timer;
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  healthUrl,
  pingService,
  startServiceKeepAlive
};
