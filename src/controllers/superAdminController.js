const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models-mongo/user');
const { child } = require('../utils/logger');

const LOG_DIR = path.join(__dirname, '../../logs');
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function getClientIp(req) {
  let ip = req?.headers?.['x-forwarded-for'] || req?.ip || req?.connection?.remoteAddress;
  if (Array.isArray(ip)) ip = ip[0];
  if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
  return ip ? String(ip) : '';
}

function safeParseJson(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function readTailText(filePath, maxBytes) {
  if (!fs.existsSync(filePath)) return '';
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const start = Math.max(0, size - maxBytes);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

function listLogFiles() {
  try {
    if (!fs.existsSync(LOG_DIR)) return [];
    const files = fs.readdirSync(LOG_DIR);
    return files
      .filter(f => /^app-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

function groupByDayUtc(isoTimestamp) {
  try {
    const d = new Date(isoTimestamp);
    if (Number.isNaN(d.getTime())) return null;
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return null;
  }
}

function lastNDaysLabelsUtc(days) {
  const out = [];
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i--) {
    const t = base - i * 24 * 60 * 60 * 1000;
    const d = new Date(t);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

async function renderLogin(req, res) {
  return res.render('superadmin/login', { error: null });
}

async function handleLogin(req, res) {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (!email || !password) {
      return res.status(400).render('superadmin/login', { error: 'Datos inválidos' });
    }

    const user = await User.findOne({ email }).exec();
    if (!user) {
      return res.status(401).render('superadmin/login', { error: 'Credenciales inválidas' });
    }
    if (!user.isVerified) {
      return res.status(403).render('superadmin/login', { error: 'Debes verificar tu correo primero' });
    }
    if (String(user.role) !== 'super_admin') {
      return res.status(403).render('superadmin/login', { error: 'No autorizado' });
    }

    const accessStatus = String(user?.access?.status || 'active').toLowerCase();
    const suspendedUntil = user?.access?.suspendedUntil ? new Date(user.access.suspendedUntil) : null;
    const disabledAt = user?.access?.disabledAt ? new Date(user.access.disabledAt) : null;
    if (accessStatus === 'disabled' || disabledAt) {
      return res.status(403).render('superadmin/login', { error: 'Cuenta deshabilitada' });
    }
    if (accessStatus === 'suspended' && suspendedUntil && suspendedUntil.getTime() > Date.now()) {
      return res.status(403).render('superadmin/login', { error: 'Cuenta suspendida temporalmente' });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).render('superadmin/login', { error: 'Credenciales inválidas' });
    }

    const ua = req?.header?.('user-agent') || req?.headers?.['user-agent'] || '';
    const ip = getClientIp(req);
    const bindIp = String(process.env.SUPERADMIN_SESSION_BIND_IP || 'false').toLowerCase() === 'true';

    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => err ? reject(err) : resolve());
    });

    req.session.superAdminUserId = String(user._id);
    req.session.superAdminLoggedInAt = new Date().toISOString();
    req.session.superAdminUaHash = sha256(ua);
    req.session.superAdminIpHash = bindIp ? sha256(ip) : undefined;

    const logger = child({ component: 'superadmin', userId: String(user._id) });
    logger.info('superadmin_login_ok');

    req.session.save((err) => {
      if (err) {
        logger.error('superadmin_session_save_error', { context: { message: err.message } });
        return res.status(500).render('superadmin/login', { error: 'Error al guardar sesión' });
      }
      // Ahora sí, redirigimos sabiendo que la sesión existe en la DB
      return res.redirect('/superadmin');
    });
  } catch (error) {
    const logger = child({ component: 'superadmin' });
    logger.error('superadmin_login_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).render('superadmin/login', { error: 'Error al iniciar sesión' });
  }
}

async function logout(req, res) {
  try {
    const uid = req?.session?.superAdminUserId ? String(req.session.superAdminUserId) : '';
    if (uid) {
      const logger = child({ component: 'superadmin', userId: uid });
      logger.info('superadmin_logout');
    }
  } catch {}
  try {
    req.session.destroy(() => {});
  } catch {}
  return res.redirect('/superadmin/login');
}

async function buildMetrics() {
  const labels = lastNDaysLabelsUtc(7);
  const requestCounts = new Map(labels.map(l => [l, 0]));

  const files = listLogFiles().slice(0, 14);
  for (const f of files) {
    const full = path.join(LOG_DIR, f);
    const content = readTailText(full, 5_000_000);
    const lines = content.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const rec = safeParseJson(line);
      if (!rec || rec.message !== 'request_completed') continue;
      const day = groupByDayUtc(rec.timestamp);
      if (!day || !requestCounts.has(day)) continue;
      requestCounts.set(day, (requestCounts.get(day) || 0) + 1);
    }
  }

  const start = new Date(labels[0] + 'T00:00:00.000Z');
  const users = await User.find({ createdAt: { $gte: start }, role: { $ne: 'super_admin' } }).select('createdAt').lean().exec();
  const newUsersByDay = new Map(labels.map(l => [l, 0]));
  for (const u of users) {
    const day = groupByDayUtc(u.createdAt);
    if (!day || !newUsersByDay.has(day)) continue;
    newUsersByDay.set(day, (newUsersByDay.get(day) || 0) + 1);
  }

  const roleAgg = await User.aggregate([
    { $match: { role: { $ne: 'super_admin' } } },
    { $group: { _id: '$role', count: { $sum: 1 } } }
  ]);
  const roles = {};
  for (const r of roleAgg) roles[String(r._id || 'unknown')] = Number(r.count || 0);

  return {
    labels,
    requests: labels.map(l => requestCounts.get(l) || 0),
    newUsers: labels.map(l => newUsersByDay.get(l) || 0),
    roles
  };
}

async function dashboard(req, res) {
  try {
    const metrics = await buildMetrics();
    return res.render('superadmin/dashboard', { metrics });
  } catch (error) {
    const logger = child({ component: 'superadmin' });
    logger.error('superadmin_dashboard_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).send('Error al cargar dashboard');
  }
}

function effectiveAccess(user) {
  const status = String(user?.access?.status || 'active').toLowerCase();
  const suspendedUntil = user?.access?.suspendedUntil ? new Date(user.access.suspendedUntil) : null;
  const disabledAt = user?.access?.disabledAt ? new Date(user.access.disabledAt) : null;
  if (disabledAt || status === 'disabled') return { status: 'disabled', suspendedUntil: null };
  if (status === 'suspended' && suspendedUntil && suspendedUntil.getTime() > Date.now()) {
    return { status: 'suspended', suspendedUntil };
  }
  return { status: 'active', suspendedUntil: null };
}

async function usersPage(req, res) {
  const q = typeof req.query?.q === 'string' ? req.query.q.trim() : '';
  const role = typeof req.query?.role === 'string' ? req.query.role.trim() : '';
  const status = typeof req.query?.status === 'string' ? req.query.status.trim() : '';

  const where = { role: { $ne: 'super_admin' } };
  if (q) where.email = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (role && role !== 'super_admin') where.role = role;
  if (status === 'disabled') where['access.status'] = 'disabled';
  if (status === 'suspended') where['access.status'] = 'suspended';
  if (status === 'active') where.$or = [{ 'access.status': { $exists: false } }, { 'access.status': 'active' }, { 'access.status': null }];

  const items = await User.find(where)
    .select('nombre apellido email role isVerified access createdAt updatedAt')
    .sort({ createdAt: -1 })
    .limit(250)
    .lean()
    .exec();

  const rows = items.map(u => {
    const eff = effectiveAccess(u);
    return {
      id: String(u._id),
      nombre: u.nombre,
      apellido: u.apellido,
      email: u.email,
      role: u.role,
      isVerified: Boolean(u.isVerified),
      status: eff.status,
      suspendedUntil: eff.suspendedUntil ? eff.suspendedUntil.toISOString() : null,
      createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null
    };
  });

  return res.render('superadmin/users', {
    q,
    role,
    status,
    users: rows
  });
}

async function setRole(req, res) {
  try {
    const targetId = String(req.params.id || '');
    const newRole = typeof req.body?.role === 'string' ? req.body.role.trim() : '';
    const allowed = ['cliente', 'editor', 'admin'];
    if (!allowed.includes(newRole)) {
      return res.status(400).send('Rol inválido');
    }
    const user = await User.findById(targetId).exec();
    if (!user) return res.status(404).send('Usuario no encontrado');
    if (String(user.role) === 'super_admin') return res.status(403).send('Acción no permitida');
    user.role = newRole;
    await user.save();
    const logger = child({ component: 'superadmin', actor: String(req.superAdmin?._id || '') });
    logger.info('superadmin_user_role_updated', { context: { targetId, role: newRole } });
    return res.redirect('/superadmin/users');
  } catch (error) {
    const logger = child({ component: 'superadmin' });
    logger.error('superadmin_user_role_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).send('Error al actualizar rol');
  }
}

async function enableUser(req, res) {
  try {
    const targetId = String(req.params.id || '');
    const user = await User.findById(targetId).exec();
    if (!user) return res.status(404).send('Usuario no encontrado');
    if (String(user.role) === 'super_admin') return res.status(403).send('Acción no permitida');
    user.access = user.access || {};
    user.access.status = 'active';
    user.access.suspendedUntil = undefined;
    user.access.disabledAt = undefined;
    user.access.reason = undefined;
    await user.save();
    const logger = child({ component: 'superadmin', actor: String(req.superAdmin?._id || '') });
    logger.info('superadmin_user_enabled', { context: { targetId } });
    return res.redirect('/superadmin/users');
  } catch (error) {
    const logger = child({ component: 'superadmin' });
    logger.error('superadmin_user_enable_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).send('Error al habilitar usuario');
  }
}

async function suspendUser(req, res) {
  try {
    const targetId = String(req.params.id || '');
    const hours = Number(req.body?.hours || 0);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 365) {
      return res.status(400).send('Duración inválida');
    }
    const user = await User.findById(targetId).exec();
    if (!user) return res.status(404).send('Usuario no encontrado');
    if (String(user.role) === 'super_admin') return res.status(403).send('Acción no permitida');
    user.access = user.access || {};
    user.access.status = 'suspended';
    user.access.suspendedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
    user.access.disabledAt = undefined;
    user.access.reason = reason || undefined;
    await user.save();
    const logger = child({ component: 'superadmin', actor: String(req.superAdmin?._id || '') });
    logger.info('superadmin_user_suspended', { context: { targetId, hours, reason: reason || undefined } });
    return res.redirect('/superadmin/users');
  } catch (error) {
    const logger = child({ component: 'superadmin' });
    logger.error('superadmin_user_suspend_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).send('Error al suspender usuario');
  }
}

async function disableUser(req, res) {
  try {
    const targetId = String(req.params.id || '');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const user = await User.findById(targetId).exec();
    if (!user) return res.status(404).send('Usuario no encontrado');
    if (String(user.role) === 'super_admin') return res.status(403).send('Acción no permitida');
    user.access = user.access || {};
    user.access.status = 'disabled';
    user.access.disabledAt = new Date();
    user.access.suspendedUntil = undefined;
    user.access.reason = reason || undefined;
    await user.save();
    const logger = child({ component: 'superadmin', actor: String(req.superAdmin?._id || '') });
    logger.info('superadmin_user_disabled', { context: { targetId, reason: reason || undefined } });
    return res.redirect('/superadmin/users');
  } catch (error) {
    const logger = child({ component: 'superadmin' });
    logger.error('superadmin_user_disable_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).send('Error al deshabilitar usuario');
  }
}

async function logsPage(req, res) {
  try {
    const files = listLogFiles();
    const selected = typeof req.query?.file === 'string' ? req.query.file.trim() : '';
    const file = selected && files.includes(selected) ? selected : (files[0] || '');
    const maxLines = Math.min(2000, Math.max(100, Number(req.query?.lines || 500)));

    let entries = [];
    if (file) {
      const full = path.join(LOG_DIR, file);
      const content = readTailText(full, 5_000_000);
      const lines = content.split(/\r?\n/).filter(Boolean).slice(-maxLines);
      entries = lines
        .map(safeParseJson)
        .filter(Boolean)
        .reverse()
        .slice(0, maxLines)
        .map(e => ({
          timestamp: e.timestamp,
          level: e.level,
          message: e.message,
          method: e.method,
          path: e.path,
          status: e.status,
          responseTimeMs: e.responseTimeMs,
          correlationId: e.correlationId,
          userId: e.userId
        }));
    }

    return res.render('superadmin/logs', {
      files,
      file,
      lines: maxLines,
      entries
    });
  } catch (error) {
    const logger = child({ component: 'superadmin' });
    logger.error('superadmin_logs_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).send('Error al cargar logs');
  }
}

module.exports = {
  renderLogin,
  handleLogin,
  logout,
  dashboard,
  usersPage,
  setRole,
  enableUser,
  suspendUser,
  disableUser,
  logsPage
};
