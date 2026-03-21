const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SERVICE_NAME = 'sfjpii-back';
const ENV = process.env.NODE_ENV || 'development';
const LOG_DIR = path.join(__dirname, '../../logs');
const TIMEZONE = 'America/Mexico_City';

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch (_) {}
}

function currentLogFile() {
  const date = new Date();
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const filename = `app-${yyyy}-${mm}-${dd}.jsonl`;
  return path.join(LOG_DIR, filename);
}

function utcTimestamp() {
  return new Date().toISOString();
}

function localTimestamp() {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(d).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const SENSITIVE_KEYS = ['password', 'token', 'authorization', 'auth', 'secret', 'jwt', 'cookie'];
  const out = {};
  for (const k of Object.keys(obj)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.includes(lower)) {
      out[k] = '[REDACTED]';
    } else if (typeof obj[k] === 'object' && obj[k] !== null) {
      out[k] = redact(obj[k]);
    } else {
      out[k] = obj[k];
    }
  }
  return out;
}

function write(line) {
  ensureLogDir();
  try {
    fs.appendFileSync(currentLogFile(), line + os.EOL, { encoding: 'utf8' });
  } catch (_) {}
}

function baseRecord(level, fields) {
  return {
    timestamp: utcTimestamp(),
    level,
    service: SERVICE_NAME,
    env: ENV,
    status: typeof fields.status === 'number' ? fields.status : null,
    responseTimeMs: typeof fields.responseTimeMs === 'number' ? fields.responseTimeMs : null,
    ...fields,
  };
}

function stringify(rec) {
  try {
    return JSON.stringify(rec);
  } catch {
    return JSON.stringify({ timestamp: utcTimestamp(), level: 'error', service: SERVICE_NAME, env: ENV, message: 'Failed to stringify log record' });
  }
}

function log(level, fields = {}) {
  const record = baseRecord(level, fields);
  const line = stringify(record);
  // Console for quick visibility (kept single line JSON)
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
  // Persist to file
  write(line);
}

function child(base = {}) {
  return {
    debug: (message, extra = {}) => log('debug', { message, ...base, ...extra, context: redact(extra.context || {}) }),
    info: (message, extra = {}) => log('info', { message, ...base, ...extra, context: redact(extra.context || {}) }),
    warn: (message, extra = {}) => log('warn', { message, ...base, ...extra, context: redact(extra.context || {}) }),
    error: (message, extra = {}) => log('error', { message, ...base, ...extra, context: redact(extra.context || {}) }),
  };
}

function generateCorrelationId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16)
  );
}

module.exports = {
  log,
  child,
  generateCorrelationId,
};
