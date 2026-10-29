const axios = require('axios');

const LOGIN_METHODS = new Set(['password', 'google', 'microsoft', 'passkey', 'qr']);
const geoCache = new Map();
const GEO_CACHE_MAX = 500;

function normalizeMethod(method) {
  const m = String(method || '').toLowerCase();
  return LOGIN_METHODS.has(m) ? m : null;
}

function isPrivateIp(ip) {
  const v = String(ip || '').replace(/^::ffff:/, '');
  return !v || v === 'Unknown' || v === '::1' || v === '127.0.0.1' ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fc|fd|fe80)/i.test(v);
}

// Ubicación aproximada (ciudad, región, país). Se puede desactivar con SESSION_GEOIP=false.
async function lookupLocation(ip) {
  if (process.env.SESSION_GEOIP === 'false' || isPrivateIp(ip)) return null;
  const key = String(ip).replace(/^::ffff:/, '');
  if (geoCache.has(key)) return geoCache.get(key);
  try {
    const { data } = await axios.get(`https://ipwho.is/${encodeURIComponent(key)}`, {
      timeout: 1500,
      params: { fields: 'success,city,region,country' }
    });
    const location = data?.success
      ? [data.city, data.region, data.country].filter(Boolean).join(', ') || null
      : null;
    if (geoCache.size >= GEO_CACHE_MAX) geoCache.delete(geoCache.keys().next().value);
    geoCache.set(key, location);
    return location;
  } catch {
    return null;
  }
}

// Un dispositivo se considera conocido si ya hubo una sesión con el mismo user-agent.
function isNewDevice(user, userAgent) {
  const tokens = Array.isArray(user?.refreshTokens) ? user.refreshTokens : [];
  if (tokens.length === 0) return false;
  const ua = String(userAgent || '');
  return !tokens.some(t => t && String(t.userAgent || '') === ua);
}

function emitToUser(req, userId, event, payload) {
  try {
    req?.app?.get?.('socketio')?.to(String(userId)).emit(event, payload);
  } catch {}
}

function emitSessionsRevoked(req, userId, sessionIds) {
  const ids = (sessionIds || []).filter(Boolean).map(String);
  if (ids.length) emitToUser(req, userId, 'sesion_revocada', { sessionIds: ids });
}

module.exports = { normalizeMethod, lookupLocation, isNewDevice, emitToUser, emitSessionsRevoked };
