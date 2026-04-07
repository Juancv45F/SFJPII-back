const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models-mongo/user');
const { child } = require('../utils/logger');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

const sanitize = (v) => typeof v === 'string' ? v.trim() : v;
const isNonEmpty = (v) => typeof v === 'string' ? v.trim().length > 0 : v !== undefined && v !== null;
const isStrongPassword = (v) => v && v.length >= 8 && /[A-Z]/.test(v) && /\d/.test(v) && /[\W_]/.test(v);
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function normalizeTheme(v) {
  const t = String(v || '').toLowerCase();
  if (t === 'dark' || t === 'light') return t;
  return null;
}

function normalizeLanguage(v) {
  const l = String(v || '').toLowerCase();
  if (l === 'es' || l === 'en') return l;
  return null;
}

function summarizeSessions(user, currentSessionId) {
  const now = Date.now();
  const tokens = Array.isArray(user?.refreshTokens) ? user.refreshTokens : [];
  const bySid = new Map();

  for (const t of tokens) {
    if (!t || (!t.sessionId && !t.tokenHash)) continue;
    const sid = String(t.sessionId || t.tokenHash);
    const createdAt = t.createdAt ? new Date(t.createdAt) : null;
    const lastUsedAt = t.lastUsedAt ? new Date(t.lastUsedAt) : createdAt;
    const expiresAt = t.expiresAt ? new Date(t.expiresAt) : null;
    const revokedAt = t.revokedAt ? new Date(t.revokedAt) : null;

    const isActive = !revokedAt && expiresAt && expiresAt.getTime() > now;

    const prev = bySid.get(sid);
    const next = prev || {
      sessionId: sid,
      createdAt: createdAt || lastUsedAt || null,
      lastUsedAt: lastUsedAt || createdAt || null,
      expiresAt: expiresAt || null,
      userAgent: t.userAgent || null,
      ip: t.ip || null,
      active: false,
      isCurrent: currentSessionId ? sid === String(currentSessionId) : false
    };

    if (createdAt && (!next.createdAt || createdAt.getTime() < new Date(next.createdAt).getTime())) {
      next.createdAt = createdAt;
    }
    if (lastUsedAt && (!next.lastUsedAt || lastUsedAt.getTime() > new Date(next.lastUsedAt).getTime())) {
      next.lastUsedAt = lastUsedAt;
      next.userAgent = t.userAgent || next.userAgent;
      next.ip = t.ip || next.ip;
    }
    if (expiresAt && (!next.expiresAt || expiresAt.getTime() > new Date(next.expiresAt).getTime())) {
      next.expiresAt = expiresAt;
    }
    if (isActive) next.active = true;

    bySid.set(sid, next);
  }

  return Array.from(bySid.values()).sort((a, b) => {
    const at = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
    const bt = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
    return bt - at;
  });
}

async function getMe(req, res) {
  try {
    const user = await User.findById(req.uid).exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    return res.json({
      user: {
        id: String(user._id),
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        rol: user.role || 'cliente',
        mfa: {
          enabled: !!user?.mfa?.enabled,
          channel: user?.mfa?.channel || 'email',
          method: user?.mfa?.method || user?.mfa?.channel || 'email',
          totpConfigured: !!user?.mfa?.totpSecret
        },
        preferences: {
          theme: user?.preferences?.theme || 'light',
          language: user?.preferences?.language || 'es'
        }
      }
    });
  } catch (error) {
    const logger = child();
    logger.error('user_me_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).json({ message: 'Error al obtener perfil' });
  }
}

async function changePassword(req, res) {
  try {
    let { currentPassword, newPassword, confirmPassword } = req.body || {};
    currentPassword = sanitize(currentPassword);
    newPassword = sanitize(newPassword);
    confirmPassword = sanitize(confirmPassword);

    if (!isNonEmpty(currentPassword) || !isNonEmpty(newPassword) || !isNonEmpty(confirmPassword)) {
      return res.status(400).json({ message: 'Datos inválidos.' });
    }
    if (String(confirmPassword) !== String(newPassword)) {
      return res.status(400).json({ message: 'Las contraseñas no coinciden.' });
    }
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ message: 'La contraseña no cumple los requisitos.' });
    }

    const user = await User.findById(req.uid).exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    const ok = await bcrypt.compare(String(currentPassword), String(user.password));
    if (!ok) return res.status(400).json({ message: 'Contraseña actual incorrecta' });

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(String(newPassword), salt);

    const now = new Date();
    if (Array.isArray(user.refreshTokens)) {
      for (const t of user.refreshTokens) {
        if (!t || t.revokedAt) continue;
        t.revokedAt = now;
        t.lastUsedAt = now;
      }
    }

    await user.save();

    const logger = child({ userId: String(user._id) });
    logger.info('user_password_changed');

    return res.json({ message: 'Contraseña actualizada. Vuelve a iniciar sesión.' });
  } catch (error) {
    const logger = child();
    logger.error('user_change_password_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).json({ message: 'Error al cambiar contraseña' });
  }
}

async function updateMfa(req, res) {
  try {
    let { enabled, channel } = req.body || {};
    const enable = Boolean(enabled);
    channel = sanitize(channel);

    const user = await User.findById(req.uid).exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    if (enable && !user.isVerified) {
      return res.status(400).json({ message: 'Debes verificar tu correo primero.' });
    }

    user.mfa = user.mfa || {};
    user.mfa.enabled = enable;
    if (isNonEmpty(channel)) {
      const next = String(channel).toLowerCase();
      if (next === 'email' || next === 'totp') {
        user.mfa.channel = next;
        user.mfa.method = next;
      } else {
        user.mfa.channel = String(channel);
      }
    }
    const method = String(user?.mfa?.method || user?.mfa?.channel || 'email').toLowerCase();
    if (enable && method === 'totp') {
      if (!isNonEmpty(user?.mfa?.totpSecret)) {
        return res.status(400).json({ message: 'Configura Google Authenticator antes de activar TOTP.' });
      }
    }
    if (!enable) {
      user.mfa.otpHash = undefined;
      user.mfa.otpExpiresAt = undefined;
      user.mfa.otpAttempts = 0;
      user.mfa.otpSentAt = undefined;
      user.mfa.totpTempSecret = undefined;
    }

    await user.save();
    return res.json({
      message: enable ? 'MFA activado' : 'MFA desactivado',
      mfa: { enabled: !!user?.mfa?.enabled, channel: user?.mfa?.channel || 'email', method: user?.mfa?.method || user?.mfa?.channel || 'email', totpConfigured: !!user?.mfa?.totpSecret }
    });
  } catch (error) {
    const logger = child();
    logger.error('user_mfa_update_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).json({ message: 'Error al actualizar MFA' });
  }
}

function backupPepper() {
  return process.env.MFA_BACKUP_PEPPER || process.env.JWT_SECRET || 'dev_backup_pepper';
}

function sha256(v) {
  return crypto.createHash('sha256').update(String(v)).digest('hex');
}

function generateBackupCodes(count, length) {
  const n = Number(count) > 0 ? Number(count) : 10;
  const len = Number(length) > 0 ? Number(length) : 10;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const out = [];
  for (let i = 0; i < n; i++) {
    const bytes = crypto.randomBytes(len);
    let code = '';
    for (let j = 0; j < len; j++) {
      code += alphabet[bytes[j] % alphabet.length];
    }
    out.push(code);
  }
  return out;
}

function hashBackupCode(code) {
  return sha256(`${backupPepper()}:${String(code).trim().toUpperCase()}`);
}

async function beginTotpSetup(req, res) {
  try {
    const user = await User.findById(req.uid).exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    if (!user.isVerified) return res.status(400).json({ message: 'Debes verificar tu correo primero.' });

    const secret = speakeasy.generateSecret({
      length: 20,
      name: `SFJPII (${String(user.email).toLowerCase()})`
    });
    const base32 = String(secret.base32 || '');
    const otpauthUrl = String(secret.otpauth_url || '');
    if (!base32 || !otpauthUrl) return res.status(500).json({ message: 'No se pudo generar el secreto TOTP.' });

    user.mfa = user.mfa || {};
    user.mfa.totpTempSecret = base32;
    user.mfa.method = 'totp';
    user.mfa.channel = 'totp';
    await user.save();

    const qrDataUrl = await qrcode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
    return res.json({ otpauthUrl, qrDataUrl, secret: base32 });
  } catch (e) {
    return res.status(500).json({ message: 'Error al iniciar configuración TOTP' });
  }
}

async function verifyTotpSetup(req, res) {
  try {
    let { code } = req.body || {};
    code = sanitize(code);
    if (!isNonEmpty(code)) return res.status(400).json({ message: 'Falta código' });
    const token = String(code).replace(/\D/g, '');
    if (token.length !== 6 && token.length !== 8) {
      return res.status(400).json({ message: 'El código debe tener 6 u 8 dígitos.' });
    }

    const user = await User.findById(req.uid).exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    const temp = user?.mfa?.totpTempSecret;
    if (!isNonEmpty(temp)) return res.status(400).json({ message: 'No hay configuración TOTP pendiente.' });

    const ok = speakeasy.totp.verify({
      secret: String(temp),
      encoding: 'base32',
      token,
      window: Number(process.env.TOTP_WINDOW || 2)
    });
    if (!ok) return res.status(400).json({ message: 'Código incorrecto.' });

    user.mfa = user.mfa || {};
    user.mfa.totpSecret = String(temp);
    user.mfa.totpTempSecret = undefined;
    user.mfa.totpVerifiedAt = new Date();
    user.mfa.enabled = true;
    user.mfa.method = 'totp';
    user.mfa.channel = 'totp';
    user.mfa.otpAttempts = 0;
    user.mfa.otpHash = undefined;
    user.mfa.otpExpiresAt = undefined;
    user.mfa.otpSentAt = undefined;

    const hasBackupCodes = Array.isArray(user?.mfa?.backupCodes) && user.mfa.backupCodes.length > 0;
    let backupCodes = null;
    if (!hasBackupCodes) {
      const codes = generateBackupCodes(Number(process.env.MFA_BACKUP_CODES_COUNT) || 10, Number(process.env.MFA_BACKUP_CODE_LENGTH) || 10);
      user.mfa.backupCodes = codes.map(c => ({ codeHash: hashBackupCode(c) }));
      backupCodes = codes;
    }
    await user.save();

    return res.json({ message: 'Google Authenticator configurado y MFA activado.', backupCodes });
  } catch (e) {
    return res.status(500).json({ message: 'Error al verificar TOTP' });
  }
}

async function resetTotpStart(req, res) {
  try {
    let { currentPassword } = req.body || {};
    currentPassword = sanitize(currentPassword);
    const user = await User.findById(req.uid).exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    if (!user.isVerified) return res.status(400).json({ message: 'Debes verificar tu correo primero.' });
    const enabledTotp = String(user?.mfa?.method || user?.mfa?.channel || '').toLowerCase() === 'totp';

    if (enabledTotp) {
      if (!isNonEmpty(currentPassword)) {
        return res.status(400).json({ message: 'Debes confirmar tu contraseña para reiniciar Google Authenticator.' });
      }
      const okPass = await bcrypt.compare(currentPassword, user.password);
      if (!okPass) return res.status(401).json({ message: 'Contraseña incorrecta.' });
    }

    const secret = speakeasy.generateSecret({
      length: 20,
      name: `SFJPII (${String(user.email).toLowerCase()})`
    });
    const base32 = String(secret.base32 || '');
    const otpauthUrl = String(secret.otpauth_url || '');
    if (!base32 || !otpauthUrl) return res.status(500).json({ message: 'No se pudo generar el secreto TOTP.' });

    user.mfa = user.mfa || {};
    user.mfa.totpTempSecret = base32;
    user.mfa.method = 'totp';
    user.mfa.channel = 'totp';
    await user.save();

    const qrDataUrl = await qrcode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
    return res.json({ otpauthUrl, qrDataUrl, secret: base32 });
  } catch (e) {
    return res.status(500).json({ message: 'Error al iniciar reinicio TOTP' });
  }
}

async function resetTotpVerify(req, res) {
  try {
    let { code } = req.body || {};
    code = sanitize(code);
    if (!isNonEmpty(code)) return res.status(400).json({ message: 'Falta código' });
    const token = String(code).replace(/\D/g, '');
    if (token.length !== 6 && token.length !== 8) {
      return res.status(400).json({ message: 'El código debe tener 6 u 8 dígitos.' });
    }

    const user = await User.findById(req.uid).exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    const temp = user?.mfa?.totpTempSecret;
    if (!isNonEmpty(temp)) return res.status(400).json({ message: 'No hay reinicio TOTP pendiente.' });

    const ok = speakeasy.totp.verify({
      secret: String(temp),
      encoding: 'base32',
      token,
      window: Number(process.env.TOTP_WINDOW || 2)
    });
    if (!ok) return res.status(400).json({ message: 'Código incorrecto.' });

    user.mfa = user.mfa || {};
    user.mfa.totpSecret = String(temp); // sustituye el secreto previo
    user.mfa.totpTempSecret = undefined;
    user.mfa.totpVerifiedAt = new Date();
    user.mfa.enabled = true;
    user.mfa.method = 'totp';
    user.mfa.channel = 'totp';
    user.mfa.otpAttempts = 0;
    user.mfa.otpHash = undefined;
    user.mfa.otpExpiresAt = undefined;
    user.mfa.otpSentAt = undefined;

    const codes = generateBackupCodes(Number(process.env.MFA_BACKUP_CODES_COUNT) || 10, Number(process.env.MFA_BACKUP_CODE_LENGTH) || 10);
    user.mfa.backupCodes = codes.map(c => ({ codeHash: hashBackupCode(c) }));
    await user.save();

    return res.json({ message: 'Google Authenticator reiniciado y activado.', backupCodes: codes });
  } catch (e) {
    return res.status(500).json({ message: 'Error al verificar reinicio TOTP' });
  }
}
async function getPreferences(req, res) {
  try {
    const user = await User.findById(req.uid).select('preferences').exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    return res.json({
      preferences: {
        theme: user?.preferences?.theme || 'light',
        language: user?.preferences?.language || 'es'
      }
    });
  } catch (error) {
    const logger = child();
    logger.error('user_preferences_get_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).json({ message: 'Error al obtener preferencias' });
  }
}

async function updatePreferences(req, res) {
  try {
    const theme = normalizeTheme(req.body?.theme);
    const language = normalizeLanguage(req.body?.language);
    if (!theme && !language) {
      return res.status(400).json({ message: 'Preferencias inválidas.' });
    }
    const user = await User.findById(req.uid).exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    user.preferences = user.preferences || {};
    if (theme) user.preferences.theme = theme;
    if (language) user.preferences.language = language;
    await user.save();
    return res.json({
      message: 'Preferencias guardadas',
      preferences: {
        theme: user?.preferences?.theme || 'light',
        language: user?.preferences?.language || 'es'
      }
    });
  } catch (error) {
    const logger = child();
    logger.error('user_preferences_update_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).json({ message: 'Error al guardar preferencias' });
  }
}

async function listSessions(req, res) {
  try {
    const user = await User.findById(req.uid).select('refreshTokens').exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    let currentSessionId = null;
    const refreshTokenHeader = req.header('x-refresh-token');
    if (refreshTokenHeader) {
      const tokenHash = sha256(refreshTokenHeader);
      const entry = (user.refreshTokens || []).find(t => t && t.tokenHash === tokenHash && !t.revokedAt);
      if (entry?.sessionId) currentSessionId = String(entry.sessionId);
    }

    const sessions = summarizeSessions(user, currentSessionId);
    return res.json({ sessions });
  } catch (error) {
    const logger = child();
    logger.error('user_sessions_list_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).json({ message: 'Error al obtener sesiones' });
  }
}

async function revokeSession(req, res) {
  try {
    let { sessionId } = req.body || {};
    sessionId = sanitize(sessionId);
    if (!isNonEmpty(sessionId)) return res.status(400).json({ message: 'Falta sessionId' });

    const user = await User.findById(req.uid).exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    const now = new Date();
    let revokedAny = false;
    if (Array.isArray(user.refreshTokens)) {
      for (const t of user.refreshTokens) {
        if (!t) continue;
        const sid = String(t.sessionId || t.tokenHash || '');
        if (sid && sid === String(sessionId) && !t.revokedAt) {
          revokedAny = true;
          t.revokedAt = now;
          t.lastUsedAt = now;
        }
      }
    }

    await user.save();
    return res.json({ message: revokedAny ? 'Sesión cerrada' : 'Sesión no encontrada' });
  } catch (error) {
    const logger = child();
    logger.error('user_sessions_revoke_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).json({ message: 'Error al cerrar sesión' });
  }
}

async function revokeOtherSessions(req, res) {
  try {
    let { refreshToken } = req.body || {};
    refreshToken = sanitize(refreshToken);
    if (!isNonEmpty(refreshToken)) return res.status(400).json({ message: 'Falta refreshToken' });

    const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, refreshSecret);
    } catch {
      return res.status(401).json({ message: 'Refresh token no válido' });
    }
    if (!decoded || decoded.typ !== 'refresh' || !decoded.uid) {
      return res.status(401).json({ message: 'Refresh token no válido' });
    }
    if (String(decoded.uid) !== String(req.uid)) {
      return res.status(401).json({ message: 'Refresh token no válido' });
    }

    const user = await User.findById(req.uid).exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    const tokenHash = sha256(refreshToken);
    const entry = (user.refreshTokens || []).find(t => t && t.tokenHash === tokenHash && !t.revokedAt);
    if (!entry) return res.status(401).json({ message: 'Refresh token revocado' });

    const currentSessionId = String(entry.sessionId || tokenHash);
    const now = new Date();
    let revokedCount = 0;
    if (Array.isArray(user.refreshTokens)) {
      for (const t of user.refreshTokens) {
        if (!t) continue;
        const sid = String(t.sessionId || t.tokenHash || '');
        if (sid && sid !== currentSessionId && !t.revokedAt) {
          revokedCount += 1;
          t.revokedAt = now;
          t.lastUsedAt = now;
        }
      }
    }

    await user.save();
    return res.json({ message: 'Sesiones remotas cerradas', revokedCount });
  } catch (error) {
    const logger = child();
    logger.error('user_sessions_revoke_others_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).json({ message: 'Error al cerrar sesiones remotas' });
  }
}

async function updateUserRole(req, res) {
  try {
    const { id } = req.params;
    const nextRoleRaw = req.body?.role ?? req.body?.rol;
    const nextRole = String(nextRoleRaw || '').trim().toLowerCase();
    const allowed = new Set(['admin', 'editor', 'cliente']);
    if (!allowed.has(nextRole)) {
      return res.status(400).json({ message: 'Rol inválido' });
    }

    const user = await User.findById(id).exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    user.role = nextRole;

    const now = new Date();
    if (Array.isArray(user.refreshTokens)) {
      for (const t of user.refreshTokens) {
        if (!t || t.revokedAt) continue;
        t.revokedAt = now;
        t.lastUsedAt = now;
      }
    }

    await user.save();

    return res.json({
      message: 'Rol actualizado',
      user: {
        id: String(user._id),
        email: user.email,
        rol: user.role
      }
    });
  } catch (error) {
    const logger = child();
    logger.error('user_role_update_error', { context: { message: error.message, stack: error.stack } });
    return res.status(500).json({ message: 'Error al actualizar rol' });
  }
}

async function getRecoveryQuestionsStatus(req, res) {
  try {
    const user = await User.findById(req.uid).select('recovery.questions').exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    
    const questions = user.recovery?.questions || [];
    return res.json({
      hasQuestions: questions.length > 0,
      count: questions.length
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error al obtener estado de preguntas' });
  }
}

async function updateRecoveryQuestions(req, res) {
  try {
    const { questions } = req.body; // [{ questionId, answer }]
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ message: 'Debes proporcionar al menos una pregunta.' });
    }

    const user = await User.findById(req.uid).exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    const newQuestions = questions.map(q => ({
      questionId: String(q.questionId).trim(),
      answerHash: sha256(String(q.answer).toLowerCase().trim()),
      attempts: 0
    }));

    user.recovery = {
      ...user.recovery,
      questions: newQuestions,
      questionsBlockedUntil: null
    };

    await user.save();
    return res.json({ message: 'Preguntas de seguridad actualizadas con éxito.' });
  } catch (error) {
    return res.status(500).json({ message: 'Error al actualizar preguntas.' });
  }
}
async function upsertPushToken(req, res) {
  try {
    let { token, platform } = req.body || {};
    token = sanitize(token);
    platform = String(platform || 'android').toLowerCase();
    if (!isNonEmpty(token)) return res.status(400).json({ message: 'Falta token' });
    const user = await User.findById(req.uid).exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    user.pushTokens = Array.isArray(user.pushTokens) ? user.pushTokens : [];
    const idx = user.pushTokens.findIndex(t => t && t.token === token);
    const now = new Date();
    if (idx === -1) {
      user.pushTokens.push({ token, platform, createdAt: now, lastSeenAt: now });
    } else {
      user.pushTokens[idx].platform = platform || user.pushTokens[idx].platform;
      user.pushTokens[idx].lastSeenAt = now;
      user.pushTokens[idx].revokedAt = undefined;
    }
    await user.save();
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: 'Error al registrar token push' });
  }
}

async function removePushToken(req, res) {
  try {
    let { token } = req.body || {};
    token = sanitize(token);
    if (!isNonEmpty(token)) return res.status(400).json({ message: 'Falta token' });
    const user = await User.findById(req.uid).exec();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    user.pushTokens = (user.pushTokens || []).filter(t => t && t.token !== token);
    await user.save();
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: 'Error al eliminar token push' });
  }
}


module.exports = {
  getMe,
  changePassword,
  updateMfa,
  beginTotpSetup,
  verifyTotpSetup,
  resetTotpStart,
  resetTotpVerify,
  getPreferences,
  updatePreferences,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  updateUserRole,
  getRecoveryQuestionsStatus,
  upsertPushToken,
  removePushToken,
  updateRecoveryQuestions
}
