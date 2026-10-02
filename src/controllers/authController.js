const mongoose = require('mongoose');
const User = require('../models-mongo/user');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { child } = require('../utils/logger');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isStrongPassword = (v) => v && v.length >= 8 && /[A-Z]/.test(v) && /\d/.test(v) && /[\W_]/.test(v);
const sanitize = (v) => typeof v === 'string' ? v.trim() : v;
const isNonEmpty = (v) => typeof v === 'string' ? v.trim().length > 0 : v !== undefined && v !== null;
const isLettersSpaces = (v) => /^[A-Za-zÀ-ÖØ-öø-ÿ\s]+$/.test(v);

// Función helper para sha256 (reutilizada del sistema de sesiones)
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const resendCooldownMs = Number(process.env.RESEND_COOLDOWN_MS) || 60 * 1000;

const REFRESH_COOKIE_NAME = process.env.AUTH_REFRESH_COOKIE_NAME || 'sfjpii_rt';
const ACCESS_COOKIE_NAME = process.env.AUTH_ACCESS_COOKIE_NAME || 'sfjpii_at';

function parseCookieHeader(header) {
    const out = {};
    if (!header || typeof header !== 'string') return out;
    const parts = header.split(';');
    for (const p of parts) {
        const i = p.indexOf('=');
        if (i === -1) continue;
        const k = p.slice(0, i).trim();
        const v = p.slice(i + 1).trim();
        if (!k) continue;
        out[k] = decodeURIComponent(v);
    }
    return out;
}

function getCookie(req, name) {
    const header = req?.headers?.cookie;
    const cookies = parseCookieHeader(header);
    return cookies && Object.prototype.hasOwnProperty.call(cookies, name) ? cookies[name] : undefined;
}

function cookieOptions(req, kind) {
    const isProd = process.env.NODE_ENV === 'production';
    const configuredSameSite = process.env.AUTH_COOKIE_SAMESITE;
    const sameSite = configuredSameSite ? String(configuredSameSite).toLowerCase() : (isProd ? 'none' : 'lax');
    const secure = sameSite === 'none' ? true : isProd;
    const maxAgeMs = kind === 'access'
        ? (Number(process.env.JWT_ACCESS_COOKIE_TTL_MS) || 15 * 60 * 1000)
        : (Number(process.env.JWT_REFRESH_COOKIE_TTL_MS) || 7 * 24 * 60 * 60 * 1000);
    const domain = process.env.AUTH_COOKIE_DOMAIN ? String(process.env.AUTH_COOKIE_DOMAIN) : undefined;
    const path = process.env.AUTH_COOKIE_PATH ? String(process.env.AUTH_COOKIE_PATH) : '/';
    return {
        httpOnly: true,
        secure,
        sameSite,
        domain,
        path,
        maxAge: maxAgeMs
    };
}

function setRefreshCookie(req, res, refreshToken) {
    if (!res || typeof res.cookie !== 'function') return;
    res.cookie(REFRESH_COOKIE_NAME, String(refreshToken), cookieOptions(req, 'refresh'));
}

function setAccessCookie(req, res, accessToken) {
    if (!res || typeof res.cookie !== 'function') return;
    res.cookie(ACCESS_COOKIE_NAME, String(accessToken), cookieOptions(req, 'access'));
}

function clearAuthCookies(req, res) {
    if (!res || typeof res.clearCookie !== 'function') return;
    res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions(req, 'refresh'));
    res.clearCookie(ACCESS_COOKIE_NAME, cookieOptions(req, 'access'));
}

function shouldUseAccessCookie() {
    return String(process.env.AUTH_USE_ACCESS_COOKIE || 'false').toLowerCase() === 'true';
}

function shouldExposeAccessTokenInBody() {
    return true;
}

function shouldExposeRefreshTokenInBody() {
    return true;
}

function remainingCooldownSec(sentAt) {
    if (!sentAt) return 0;
    const elapsed = Date.now() - new Date(sentAt).getTime();
    const remainingMs = resendCooldownMs - elapsed;
    if (remainingMs <= 0) return 0;
    return Math.ceil(remainingMs / 1000);
}

function createAccessToken(user) {
    const payload = {
        uid: String(user._id),
        nombre: user.nombre,
        rol: user.role || 'cliente'
    };
    const expiresIn = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

function createRefreshToken(user, sessionId) {
    const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
    const jti = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const sid = sessionId ? String(sessionId) : (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
    const payload = { uid: String(user._id), typ: 'refresh', jti, sid };
    return jwt.sign(payload, refreshSecret, { expiresIn });
}

function createMfaToken(user) {
    const secret = process.env.JWT_MFA_SECRET || process.env.JWT_SECRET;
    const expiresIn = process.env.JWT_MFA_EXPIRES_IN || '10m';
    const payload = { uid: String(user._id), typ: 'mfa' };
    return jwt.sign(payload, secret, { expiresIn });
}

let smtpTransporterPromise = null;
let smtpTransporterConfigKey = null;

function isEmailSimulationEnabled() {
    if (process.env.EMAIL_SIMULATION_ENABLED === 'true') return true;
    return process.env.NODE_ENV !== 'production';
}

function getFromInfo() {
    const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;
    const fromName = process.env.SMTP_FROM_NAME;
    return {
        fromEmail,
        fromName,
        from: fromName ? `${fromName} <${fromEmail}>` : fromEmail
    };
}

function getSmtpConfig() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) return null;

    const port = Number(process.env.SMTP_PORT) || 587;
    const secure = typeof process.env.SMTP_SECURE === 'string'
        ? process.env.SMTP_SECURE === 'true'
        : port === 465;
    const requireTLS = process.env.SMTP_REQUIRE_TLS === 'true';
    const rejectUnauthorized = process.env.SMTP_REJECT_UNAUTHORIZED === 'false' ? false : undefined;

    const connectionTimeout = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 10_000;
    const greetingTimeout = Number(process.env.SMTP_GREETING_TIMEOUT_MS) || 10_000;
    const socketTimeout = Number(process.env.SMTP_SOCKET_TIMEOUT_MS) || 20_000;

    const { from } = getFromInfo();

    return {
        host,
        port,
        secure,
        requireTLS,
        rejectUnauthorized,
        user,
        pass,
        connectionTimeout,
        greetingTimeout,
        socketTimeout,
        from
    };
}

function getHttpEmailProvider() {
    const provider = String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
    const sendgridKey = process.env.SENDGRID_API_KEY;
    const brevoKey = process.env.BREVO_API_KEY;

    if (provider === 'sendgrid' && sendgridKey) return { provider: 'sendgrid', apiKey: sendgridKey };
    if (provider === 'brevo' && brevoKey) return { provider: 'brevo', apiKey: brevoKey };

    if (sendgridKey) return { provider: 'sendgrid', apiKey: sendgridKey };
    if (brevoKey) return { provider: 'brevo', apiKey: brevoKey };

    return null;
}

async function sendEmailViaHttp({ to, subject, text, logger }) {
    const cfg = getHttpEmailProvider();
    if (!cfg) return false;

    const { fromEmail, fromName } = getFromInfo();
    if (!fromEmail) {
        logger?.warn?.('email_from_missing');
        return false;
    }

    try {
        if (cfg.provider === 'sendgrid') {
            const payload = {
                personalizations: [{ to: [{ email: to }] }],
                from: fromName ? { email: fromEmail, name: fromName } : { email: fromEmail },
                subject,
                content: [{ type: 'text/plain', value: text }]
            };
            await axios.post('https://api.sendgrid.com/v3/mail/send', payload, {
                headers: {
                    Authorization: `Bearer ${cfg.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: Number(process.env.EMAIL_HTTP_TIMEOUT_MS) || 10_000
            });
            logger?.info?.('email_http_send_success', { context: { provider: cfg.provider, to } });
            return true;
        }

        if (cfg.provider === 'brevo') {
            const payload = {
                sender: fromName ? { email: fromEmail, name: fromName } : { email: fromEmail },
                to: [{ email: to }],
                subject,
                textContent: text
            };
            await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
                headers: {
                    'api-key': cfg.apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: Number(process.env.EMAIL_HTTP_TIMEOUT_MS) || 10_000
            });
            logger?.info?.('email_http_send_success', { context: { provider: cfg.provider, to } });
            return true;
        }

        logger?.warn?.('email_http_provider_unsupported', { context: { provider: cfg.provider } });
        return false;
    } catch (err) {
        logger?.error?.('email_http_send_failed', {
            context: {
                provider: cfg.provider,
                message: err.message,
                status: err?.response?.status,
                to
            }
        });
        return false;
    }
}

async function sendAccountNotFoundEmail({ to, action, logger }) {
    let sentByEmail = false;
    const subject = action === 'recovery' 
        ? 'Aviso de seguridad: Recuperación de contraseña' 
        : 'Aviso de seguridad: Solicitud de código OTP';
        
    const text = `Hola,\n\nHemos recibido una solicitud de ${action === 'recovery' ? 'recuperación de contraseña' : 'código OTP'} asociada a esta dirección de correo electrónico.\n\nSin embargo, te informamos que no existe ninguna cuenta registrada con este correo en nuestra plataforma. Si no fuiste tú quien realizó esta solicitud, puedes ignorar este mensaje de forma segura.\n\nSaludos.`;

    try {
        const httpPreferred = !!getHttpEmailProvider();
        if (httpPreferred) {
            // Usa Brevo/Sendgrid automáticamente
            sentByEmail = await sendEmailViaHttp({ to, subject, text, logger });
            if (sentByEmail) return true;
        }

        const smtpCfg = getSmtpConfig();
        const transporter = await getSmtpTransporter(logger);
        if (transporter && smtpCfg) {
            await transporter.sendMail({ from: smtpCfg.from, to, subject, text });
            logger.info('security_alert_email_success', { context: { to } });
            sentByEmail = true;
        }
    } catch (err) {
        logger?.error?.('security_alert_email_failed', { context: { to, error: err.message } });
        sentByEmail = false;
    }
    
    if (!sentByEmail && isEmailSimulationEnabled()) {
        console.log('=============================================');
        console.log(`🛡️  [ALERTA SIMULADA] Mensaje para ${to}:`);
        console.log(`Intento de ${action} fallido (cuenta no existe).`);
        console.log('=============================================');
    }
    return sentByEmail;
}

function getSmtpConfigKey(cfg) {
    return JSON.stringify({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        requireTLS: cfg.requireTLS,
        rejectUnauthorized: cfg.rejectUnauthorized,
        user: cfg.user,
        connectionTimeout: cfg.connectionTimeout,
        greetingTimeout: cfg.greetingTimeout,
        socketTimeout: cfg.socketTimeout
    });
}

async function getSmtpTransporter(logger) {
    const cfg = getSmtpConfig();
    if (!cfg) return null;

    const nextKey = getSmtpConfigKey(cfg);
    if (smtpTransporterConfigKey !== nextKey) {
        smtpTransporterConfigKey = nextKey;
        smtpTransporterPromise = null;
    }

    if (!smtpTransporterPromise) {
        smtpTransporterPromise = (async () => {
            const transporter = nodemailer.createTransport({
                host: cfg.host,
                port: cfg.port,
                secure: cfg.secure,
                auth: {
                    user: cfg.user,
                    pass: cfg.pass
                },
                requireTLS: cfg.requireTLS,
                tls: cfg.rejectUnauthorized === undefined ? undefined : { rejectUnauthorized: cfg.rejectUnauthorized },
                connectionTimeout: cfg.connectionTimeout,
                greetingTimeout: cfg.greetingTimeout,
                socketTimeout: cfg.socketTimeout
            });
            await transporter.verify();
            logger?.info?.('smtp_verify_ok', { context: { host: cfg.host, port: cfg.port, secure: cfg.secure } });
            return transporter;
        })().catch((err) => {
            smtpTransporterPromise = null;
            logger?.error?.('smtp_init_failed', {
                context: {
                    message: err.message,
                    code: err.code,
                    response: err.response,
                    command: err.command,
                    host: cfg.host,
                    port: cfg.port,
                    secure: cfg.secure,
                    requireTLS: cfg.requireTLS,
                    connectionTimeout: cfg.connectionTimeout,
                    greetingTimeout: cfg.greetingTimeout,
                    socketTimeout: cfg.socketTimeout
                }
            });
            throw err;
        });
    }

    return smtpTransporterPromise;
}

async function sendOtpEmail({ to, code, logger }) {
    let sentByEmail = false;
    try {
        const httpPreferred = !!getHttpEmailProvider();
        if (httpPreferred) {
            sentByEmail = await sendEmailViaHttp({
                to,
                subject: 'Código de acceso (MFA)',
                text: `Tu código OTP es: ${code}. Expira pronto.`,
                logger
            });
            if (sentByEmail) return true;
        }

        const smtpCfg = getSmtpConfig();
        const transporter = await getSmtpTransporter(logger);
        if (transporter && smtpCfg) {
            const info = await transporter.sendMail({
                from: smtpCfg.from,
                to,
                subject: 'Código de acceso (MFA)',
                text: `Tu código OTP es: ${code}. Expira pronto.`
            });
            logger.info('mfa_email_send_success', { context: { to, messageId: info && info.messageId ? info.messageId : null } });
            sentByEmail = true;
        } else {
            logger.warn('mfa_email_not_configured');
        }
    } catch (err) {
        const cfg = getSmtpConfig();
        logger.error('mfa_email_send_failed', {
            context: {
                message: err.message,
                code: err.code,
                response: err.response,
                command: err.command,
                host: cfg?.host,
                port: cfg?.port,
                secure: cfg?.secure
            }
        });
        sentByEmail = false;
    }
    if (!sentByEmail) {
        if (isEmailSimulationEnabled()) {
            console.log('=============================================');
            console.log(`📲  [OTP SIMULADO] Mensaje para ${to}:`);
            console.log(`🔐  Tu código OTP es: ${code}`);
            console.log('=============================================');
        }
    }
    return sentByEmail;
}

async function sendRecoveryEmail({ to, code, logger }) {
    let sentByEmail = false;
    try {
        const httpPreferred = !!getHttpEmailProvider();
        if (httpPreferred) {
            sentByEmail = await sendEmailViaHttp({
                to,
                subject: 'Recuperación de contraseña',
                text: `Tu código de recuperación es: ${code}\n\nTienes 15 minutos para usarlo.`,
                logger
            });
            if (sentByEmail) return true;
        }

        const smtpCfg = getSmtpConfig();
        const transporter = await getSmtpTransporter(logger);
        if (transporter && smtpCfg) {
            const info = await transporter.sendMail({
                from: smtpCfg.from,
                to,
                subject: 'Recuperación de contraseña',
                text: `Tu código de recuperación es: ${code}\n\nTienes 15 minutos para usarlo.`
            });
            logger.info('recovery_email_send_success', { context: { to, messageId: info && info.messageId ? info.messageId : null } });
            sentByEmail = true;
        } else {
            logger.warn('recovery_email_not_configured');
        }
    } catch (err) {
        const cfg = getSmtpConfig();
        logger.error('recovery_email_send_failed', {
            context: {
                message: err.message,
                code: err.code,
                host: cfg?.host
            }
        });
        sentByEmail = false;
    }
    
    // Fallback a simulación si no se pudo enviar y no estamos forzando producción
    if (!sentByEmail && isEmailSimulationEnabled()) {
        console.log('=============================================');
        console.log(`✉️  [EMAIL SIMULADO] Recuperación para ${to}:`);
        console.log(`🔐  Tu código de recuperación es: ${code}`);
        console.log('=============================================');
    }
    
    return sentByEmail;
}

async function sendVerificationEmail({ to, code, logger }) {
    let sentByEmail = false;
    try {
        const httpPreferred = !!getHttpEmailProvider();
        if (httpPreferred) {
            sentByEmail = await sendEmailViaHttp({
                to,
                subject: 'Código de verificación',
                text: `Tu código de verificación es: ${code}`,
                logger
            });
            if (sentByEmail) return true;
        }

        const smtpCfg = getSmtpConfig();
        const transporter = await getSmtpTransporter(logger);
        if (transporter && smtpCfg) {
            const info = await transporter.sendMail({
                from: smtpCfg.from,
                to,
                subject: 'Código de verificación',
                text: `Tu código de verificación es: ${code}`
            });
            logger.info('verify_email_send_success', { context: { to, messageId: info && info.messageId ? info.messageId : null } });
            sentByEmail = true;
        } else {
            logger.warn('verify_email_not_configured');
        }
    } catch (err) {
        const cfg = getSmtpConfig();
        logger.error('verify_email_send_failed', {
            context: {
                message: err.message,
                code: err.code,
                response: err.response,
                command: err.command,
                host: cfg?.host,
                port: cfg?.port,
                secure: cfg?.secure
            }
        });
        sentByEmail = false;
    }
    if (!sentByEmail) {
        if (isEmailSimulationEnabled()) {
            console.log('=============================================');
            console.log(`✉️  [EMAIL SIMULADO] Mensaje para ${to}:`);
            console.log(`🔐  Tu código de verificación es: ${code}`);
            console.log('=============================================');
        }
    }
    return sentByEmail;
}

async function persistRefreshToken({ user, refreshToken, req, isRotation = false, oldTokenHash = null }) {
    const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    const decoded = jwt.verify(refreshToken, refreshSecret);
    const expMs = decoded && decoded.exp ? decoded.exp * 1000 : (Date.now() + 7 * 24 * 60 * 60 * 1000);
    const tokenHash = sha256(refreshToken);
    const sessionId = decoded && decoded.sid ? String(decoded.sid) : (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
    
    // Obtener IP y User-Agent
    const userAgent = req?.header?.('user-agent') || req?.headers?.['user-agent'];
    let ip = req?.ip || req?.headers?.['x-forwarded-for'] || req?.connection?.remoteAddress;
    if (Array.isArray(ip)) ip = ip[0];
    if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();

    user.refreshTokens = Array.isArray(user.refreshTokens) ? user.refreshTokens : [];

    if (isRotation && oldTokenHash) {
        // Si es rotación, buscamos el token viejo y lo marcamos como revocado
        const idx = user.refreshTokens.findIndex(t => t.tokenHash === oldTokenHash);
        if (idx !== -1) {
            user.refreshTokens[idx].revokedAt = new Date();
            user.refreshTokens[idx].replacedByTokenHash = tokenHash;
        }
    }

    // Agregar la nueva sesión / token
    user.refreshTokens.push({
        sessionId,
        tokenHash,
        expiresAt: new Date(expMs),
        lastUsedAt: new Date(),
        userAgent: userAgent ? String(userAgent).substring(0, 500) : 'Unknown',
        ip: ip ? String(ip) : 'Unknown'
    });

    // Limitar número de tokens (opcional, para evitar saturar el documento)
    const maxTokens = Number(process.env.JWT_REFRESH_MAX_TOKENS) || 20;
    if (user.refreshTokens.length > maxTokens) {
        // Eliminar los más viejos que ya estén expirados o revocados primero
        user.refreshTokens.sort((a, b) => {
            const aActive = !a.revokedAt && new Date(a.expiresAt) > new Date();
            const bActive = !b.revokedAt && new Date(b.expiresAt) > new Date();
            if (aActive !== bActive) return aActive ? 1 : -1;
            return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
        });
        user.refreshTokens = user.refreshTokens.slice(user.refreshTokens.length - maxTokens);
    }

    await user.save();
}
// REGISTRO COMPLETO (Usuario + Ubicación + Captcha)
const register = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        // Recibimos los datos estructurados desde el Frontend
        let { nombre, apellido, email, password, confirmPassword, ubicacion, recaptchaToken } = req.body;
        nombre = sanitize(nombre);
        apellido = sanitize(apellido);
        email = sanitize(email);
        password = sanitize(password);
        confirmPassword = sanitize(
            confirmPassword ??
            req.body?.confirm_password ??
            req.body?.password2 ??
            req.body?.passwordConfirmation ??
            req.body?.confirm
        );
        if (!isNonEmpty(nombre) || !isNonEmpty(apellido) || !isNonEmpty(email) || !isNonEmpty(password) || !ubicacion) {
            return res.status(400).json({ message: 'Campos requeridos faltantes.' });
        }
        if (!isLettersSpaces(nombre) || !isLettersSpaces(apellido)) {
            return res.status(400).json({ message: 'Nombre y apellido inválidos.' });
        }
        if (!isEmail(email)) {
            return res.status(400).json({ message: 'Correo inválido.' });
        }
        if (!isStrongPassword(password)) {
            return res.status(400).json({ message: 'La contraseña no cumple los requisitos.' });
        }
        if (isNonEmpty(confirmPassword) && password !== confirmPassword) {
            return res.status(400).json({ message: 'Las contraseñas no coinciden.' });
        }
        if (!ubicacion.calle || !ubicacion.numero || !ubicacion.codigo_postal) {
            return res.status(400).json({ message: 'Ubicación incompleta.' });
        }
        ubicacion.calle = sanitize(ubicacion.calle);
        ubicacion.numero = sanitize(ubicacion.numero);
        ubicacion.codigo_postal = sanitize(ubicacion.codigo_postal);
        ubicacion.descripcion = sanitize(ubicacion.descripcion || '');
        ubicacion.alias = sanitize(ubicacion.alias || 'Principal');
        if (!isNonEmpty(ubicacion.calle) || !isNonEmpty(ubicacion.numero) || !isNonEmpty(ubicacion.codigo_postal)) {
            return res.status(400).json({ message: 'Ubicación inválida.' });
        }

        // --- VALIDACIÓN CAPTCHA ---
        if (!recaptchaToken) {
            return res.status(400).json({ message: 'Falta el captcha' });
        }

        const secretKey = process.env.RECAPTCHA_SECRET_KEY;
        if (!secretKey) {
            console.error('[REGISTER] RECAPTCHA_SECRET_KEY no está configurada en el servidor.');
            return res.status(500).json({ message: 'Error de configuración del servidor (captcha).' });
        }
        const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${recaptchaToken}`;

        let googleResponse;
        try {
            googleResponse = await axios.post(verifyUrl, null, { timeout: 8000 });
        } catch (captchaErr) {
            console.error('[REGISTER] Error verificando captcha:', captchaErr.message);
            return res.status(502).json({ message: 'No se pudo verificar el captcha. Intenta de nuevo.' });
        }

        // TEMPORAL: log de diagnóstico — quítalo una vez resuelto el problema
        console.log('[REGISTER] Respuesta de Google reCAPTCHA:', googleResponse.data);

        if (!googleResponse.data.success) {
            return res.status(400).json({
                message: 'Captcha inválido',
                // TEMPORAL: exponemos los error-codes de Google para diagnosticar. Quítalo después.
                debugCaptchaErrors: googleResponse.data['error-codes']
            });
        }
        

        // --- VALIDAR DUPLICADOS ---
        const existingUser = await User.findOne({ email }).exec();
        if (existingUser) {
            return res.status(400).json({ message: 'Este correo ya está registrado.' });
        }

        // --- PREPARAR DATOS ---
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const emailCode = Math.floor(100000 + Math.random() * 900000).toString();

        let newUserDoc;
        await session.withTransaction(async () => {
            const newUser = await User.create([{
                nombre,
                apellido,
                email,
                password: hashedPassword,
                verificationCode: emailCode,
                verificationCodeSentAt: new Date(),
                isVerified: false,
                role: 'cliente',
                ubicaciones: [{
                    calle: ubicacion.calle,
                    numero: ubicacion.numero,
                    codigo_postal: ubicacion.codigo_postal,
                    descripcion: ubicacion.descripcion,
                    alias: ubicacion.alias || 'Principal'
                }]
            }], { session });
            newUserDoc = newUser[0];
        });

        const regLogger = child({ userId: String(newUserDoc._id) });
        regLogger.info('usuario_registrado');

        // Envío de correo
        const sent = await sendVerificationEmail({ to: email, code: emailCode, logger: regLogger });
        const requireEmail = process.env.EMAIL_REQUIRED_ON_REGISTER === 'true' || process.env.NODE_ENV === 'production';
        if (!sent && requireEmail && !isEmailSimulationEnabled()) {
            try {
                await User.deleteOne({ _id: newUserDoc._id }).exec();
            } catch (cleanupErr) {
                regLogger.error('register_cleanup_failed', { context: { message: cleanupErr.message } });
            }
            return res.status(503).json({ message: 'No se pudo enviar el correo de verificación. Intenta de nuevo más tarde.' });
        }

        res.status(201).json({
            message: 'Registro exitoso. Revisa tu correo para el código.',
            userId: String(newUserDoc._id)
        });

    } catch (error) {
        const logger = child();
        logger.error('registro_error', { context: { message: error.message, stack: error.stack } });
        res.status(500).json({ message: 'Error en el servidor al registrar.' });
    } finally {
        session.endSession();
    }
};

// VERIFICACIÓN DE CÓDIGO 
const verifyCode = async (req, res) => {
    try {
        let { email, code } = req.body;
        email = sanitize(email);
        code = sanitize(code);
        if (!isEmail(email) || !isNonEmpty(code)) {
            return res.status(400).json({ message: 'Datos inválidos.' });
        }

        const user = await User.findOne({ email }).exec();

        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

        if (user.verificationCode !== code) {
            return res.status(400).json({ message: 'Código incorrecto' });
        }

        // Activar usuario
        await User.updateOne(
            { _id: user._id },
            { $set: { isVerified: true, verificationCode: null, verificationCodeSentAt: null } }
        ).exec();

        res.status(200).json({
            message: '¡Verificación exitosa! Ya puedes iniciar sesión.',
            isVerified: true
        });

    } catch (error) {
        res.status(500).json({ message: 'Error al verificar.' });
    }
};

const resendVerifyCode = async (req, res) => {
    try {
        let { email } = req.body || {};
        email = sanitize(email);
        if (!isEmail(email)) {
            return res.status(400).json({ message: 'Correo inválido.' });
        }

        const user = await User.findOne({ email }).exec();
        if (!user) {
            // Enviar alerta en lugar de decir "Usuario no encontrado"
            const logger = child();
            await sendAccountNotFoundEmail({ to: email, action: 'otp', logger });
            
            // Simular respuesta exitosa para evitar enumeración
            return res.json({ 
                message: 'Código reenviado', 
                retryAfterSec: Math.ceil(resendCooldownMs / 1000) 
            });
        }
        if (user.isVerified) return res.status(400).json({ message: 'El usuario ya está verificado' });

        const waitSec = remainingCooldownSec(user.verificationCodeSentAt);
        if (waitSec > 0) {
            return res.status(429).json({ message: `Espera ${waitSec}s para reenviar`, retryAfterSec: waitSec });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        user.verificationCode = code;
        user.verificationCodeSentAt = new Date();
        await user.save();

        const logger = child({ userId: String(user._id) });
        const sent = await sendVerificationEmail({ to: user.email, code, logger });
        if (!sent && process.env.NODE_ENV === 'production' && !isEmailSimulationEnabled()) {
            return res.status(503).json({ message: 'No se pudo enviar el correo. Intenta más tarde.' });
        }
        return res.json({ message: 'Código reenviado', retryAfterSec: Math.ceil(resendCooldownMs / 1000) });
    } catch (error) {
        const logger = child();
        logger.error('resend_verify_error', { context: { message: error.message, stack: error.stack } });
        res.status(500).json({ message: 'Error al reenviar código' });
    }
};

// LOGIN 
const login = async (req, res) => {
    try {
        let { email, password } = req.body;
        email = sanitize(email);
        password = sanitize(password);
        if (!isEmail(email) || !isNonEmpty(password)) {
            return res.status(400).json({ message: 'Datos inválidos.' });
        }

        const user = await User.findOne({ email }).exec();

        if (!user) return res.status(400).json({ message: 'Credenciales inválidas' });

        // Verificar si ya confirmó su SMS
        if (!user.isVerified) {
            return res.status(403).json({ message: 'Debes verificar tu correo primero.' });
        }

        const accessStatus = String(user?.access?.status || 'active').toLowerCase();
        const suspendedUntil = user?.access?.suspendedUntil ? new Date(user.access.suspendedUntil) : null;
        const disabledAt = user?.access?.disabledAt ? new Date(user.access.disabledAt) : null;
        if (accessStatus === 'disabled' || disabledAt) {
            return res.status(403).json({ message: 'Tu cuenta está deshabilitada' });
        }
        if (accessStatus === 'suspended' && suspendedUntil && suspendedUntil.getTime() > Date.now()) {
            return res.status(403).json({
                message: 'Tu cuenta está suspendida temporalmente',
                suspendedUntil
            });
        }

        // Verificar contraseña
        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(400).json({ message: 'Credenciales inválidas' });

        if (user?.mfa?.enabled) {
            const method = String(user?.mfa?.method || user?.mfa?.channel || 'email').toLowerCase();
            if (method === 'totp' && user?.mfa?.totpSecret) {
                const mfaToken = createMfaToken(user);
                return res.json({
                    message: 'Se requiere verificación MFA',
                    mfaRequired: true,
                    mfaMethod: 'totp',
                    mfaToken,
                    email: user.email
                });
            }

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const otpSalt = await bcrypt.genSalt(10);
            const otpHash = await bcrypt.hash(otp, otpSalt);
            const expiresAt = new Date(Date.now() + (Number(process.env.MFA_OTP_TTL_MS) || 5 * 60 * 1000));

            user.mfa = user.mfa || {};
            user.mfa.method = 'email';
            user.mfa.channel = 'email';
            user.mfa.otpHash = otpHash;
            user.mfa.otpExpiresAt = expiresAt;
            user.mfa.otpAttempts = 0;
            user.mfa.otpSentAt = new Date();
            await user.save();

            const loginLogger = child({ userId: String(user._id) });
            const sent = await sendOtpEmail({ to: user.email, code: otp, logger: loginLogger });
            if (!sent && process.env.NODE_ENV === 'production' && !isEmailSimulationEnabled()) {
                return res.status(503).json({ message: 'No se pudo enviar el código OTP. Intenta más tarde.' });
            }

            const mfaToken = createMfaToken(user);
            return res.json({
                message: 'Se requiere verificación MFA',
                mfaRequired: true,
                mfaMethod: 'email',
                mfaToken,
                email: user.email
            });
        }

        const token = createAccessToken(user);
        const refreshToken = createRefreshToken(user);
        await persistRefreshToken({ user, refreshToken, req });

        setRefreshCookie(req, res, refreshToken);
        if (shouldUseAccessCookie()) setAccessCookie(req, res, token);

        res.json({
            message: 'Bienvenido',
            ...(shouldExposeAccessTokenInBody() ? { token } : {}),
            ...(shouldExposeRefreshTokenInBody() ? { refreshToken } : {}),
            user: {
                id: String(user._id),
                nombre: user.nombre,
                rol: user.role || 'cliente'
            }
        });
        const loginLogger = child({ userId: String(user._id) });
        loginLogger.info('login_exitoso');

    } catch (error) {
        const logger = child();
        logger.error('login_error', { context: { message: error.message, stack: error.stack } });
        res.status(500).json({ message: 'Error en el login' });
    }
};

const resendMfaOtp = async (req, res) => {
    try {
        let { mfaToken, method } = req.body || {};
        mfaToken = sanitize(mfaToken);
        method = sanitize(method);
        if (!isNonEmpty(mfaToken)) {
            return res.status(400).json({ message: 'Falta mfaToken' });
        }

        const secret = process.env.JWT_MFA_SECRET || process.env.JWT_SECRET;
        let decoded;
        try {
            decoded = jwt.verify(mfaToken, secret);
        } catch {
            return res.status(401).json({ message: 'Token MFA no válido' });
        }
        if (!decoded || decoded.typ !== 'mfa' || !decoded.uid) {
            return res.status(401).json({ message: 'Token MFA no válido' });
        }

        const user = await User.findById(String(decoded.uid)).exec();
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
        if (!user?.mfa?.enabled) {
            return res.status(400).json({ message: 'MFA no está habilitado para este usuario' });
        }
        const configuredMethod = String(user?.mfa?.method || user?.mfa?.channel || 'email').toLowerCase();
        const requestedMethod = isNonEmpty(method) ? String(method).toLowerCase() : '';
        const effectiveMethod = requestedMethod || configuredMethod;
        if (effectiveMethod !== 'email') {
            return res.status(400).json({ message: 'Método inválido para reenvío' });
        }

        const waitSec = remainingCooldownSec(user?.mfa?.otpSentAt);
        if (waitSec > 0) {
            return res.status(429).json({ message: `Espera ${waitSec}s para reenviar`, retryAfterSec: waitSec });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpSalt = await bcrypt.genSalt(10);
        const otpHash = await bcrypt.hash(otp, otpSalt);
        const expiresAt = new Date(Date.now() + (Number(process.env.MFA_OTP_TTL_MS) || 5 * 60 * 1000));

        user.mfa = user.mfa || {};
        user.mfa.otpHash = otpHash;
        user.mfa.otpExpiresAt = expiresAt;
        user.mfa.otpAttempts = 0;
        user.mfa.otpSentAt = new Date();
        await user.save();

        const logger = child({ userId: String(user._id) });
        const sent = await sendOtpEmail({ to: user.email, code: otp, logger });
        if (!sent && process.env.NODE_ENV === 'production' && !isEmailSimulationEnabled()) {
            return res.status(503).json({ message: 'No se pudo enviar el código OTP. Intenta más tarde.' });
        }
        return res.json({ message: 'OTP reenviado', retryAfterSec: Math.ceil(resendCooldownMs / 1000), mfaMethod: 'email' });
    } catch (error) {
        const logger = child();
        logger.error('resend_mfa_error', { context: { message: error.message, stack: error.stack } });
        res.status(500).json({ message: 'Error al reenviar OTP' });
    }
};

const verifyMfa = async (req, res) => {
    try {
        let { mfaToken, otp, method } = req.body || {};
        mfaToken = sanitize(mfaToken);
        otp = sanitize(otp);
        method = sanitize(method);
        if (!isNonEmpty(mfaToken) || !isNonEmpty(otp)) {
            return res.status(400).json({ message: 'Datos inválidos.' });
        }

        const secret = process.env.JWT_MFA_SECRET || process.env.JWT_SECRET;
        let decoded;
        try {
            decoded = jwt.verify(mfaToken, secret);
        } catch {
            return res.status(401).json({ message: 'Token MFA no válido' });
        }
        if (!decoded || decoded.typ !== 'mfa' || !decoded.uid) {
            return res.status(401).json({ message: 'Token MFA no válido' });
        }

        const user = await User.findById(String(decoded.uid)).exec();
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
        if (!user?.mfa?.enabled) {
            return res.status(400).json({ message: 'MFA no está habilitado para este usuario' });
        }

        const maxAttempts = Number(process.env.MFA_OTP_MAX_ATTEMPTS) || 5;
        const attempts = Number(user?.mfa?.otpAttempts || 0);
        if (attempts >= maxAttempts) {
            return res.status(429).json({ message: 'Demasiados intentos' });
        }

        const configuredMethod = String(user?.mfa?.method || user?.mfa?.channel || 'email').toLowerCase();
        const requestedMethod = isNonEmpty(method) ? String(method).toLowerCase() : '';
        const effectiveMethod = requestedMethod || configuredMethod;

        const backupPepper = process.env.MFA_BACKUP_PEPPER || process.env.JWT_SECRET || 'dev_backup_pepper';
        const hashBackup = (code) => sha256(`${backupPepper}:${String(code).trim().toUpperCase()}`);

        if (effectiveMethod === 'backup') {
            const candidate = String(otp).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
            if (candidate.length < 8 || candidate.length > 16) {
                return res.status(400).json({ message: 'Código de respaldo inválido' });
            }
            const codes = Array.isArray(user?.mfa?.backupCodes) ? user.mfa.backupCodes : [];
            const h = hashBackup(candidate);
            const idx = codes.findIndex(c => c && !c.usedAt && String(c.codeHash) === h);
            if (idx === -1) {
                user.mfa.otpAttempts = attempts + 1;
                await user.save();
                return res.status(400).json({ message: 'Código de respaldo incorrecto' });
            }
            codes[idx].usedAt = new Date();
            user.mfa.backupCodes = codes;
        } else if (effectiveMethod === 'totp') {
            if (!isNonEmpty(user?.mfa?.totpSecret)) {
                return res.status(400).json({ message: 'TOTP no configurado' });
            }
            const token = String(otp).replace(/\D/g, '');
            if (token.length !== 6 && token.length !== 8) {
                return res.status(400).json({ message: 'El código debe tener 6 u 8 dígitos.' });
            }
            const ok = speakeasy.totp.verify({
                secret: String(user.mfa.totpSecret),
                encoding: 'base32',
                token,
                window: Number(process.env.TOTP_WINDOW || 2)
            });
            if (!ok) {
                user.mfa.otpAttempts = attempts + 1;
                await user.save();
                return res.status(400).json({ message: 'Código incorrecto' });
            }
        } else if (effectiveMethod === 'email') {
            const now = new Date();
            const otpExpiresAt = user?.mfa?.otpExpiresAt ? new Date(user.mfa.otpExpiresAt) : null;
            if (!user?.mfa?.otpHash || !otpExpiresAt || otpExpiresAt.getTime() < now.getTime()) {
                return res.status(400).json({ message: 'OTP expirado o no solicitado' });
            }

            const ok = await bcrypt.compare(String(otp), String(user.mfa.otpHash));
            if (!ok) {
                user.mfa.otpAttempts = attempts + 1;
                await user.save();
                return res.status(400).json({ message: 'OTP incorrecto' });
            }
        } else {
            return res.status(400).json({ message: 'Método MFA inválido' });
        }

        user.mfa.otpHash = undefined;
        user.mfa.otpExpiresAt = undefined;
        user.mfa.otpAttempts = 0;
        await user.save();

        const token = createAccessToken(user);
        const refreshToken = createRefreshToken(user);
        await persistRefreshToken({ user, refreshToken, req });

        setRefreshCookie(req, res, refreshToken);
        if (shouldUseAccessCookie()) setAccessCookie(req, res, token);

        return res.json({
            message: 'Bienvenido',
            ...(shouldExposeAccessTokenInBody() ? { token } : {}),
            ...(shouldExposeRefreshTokenInBody() ? { refreshToken } : {}),
            user: {
                id: String(user._id),
                nombre: user.nombre,
                rol: user.role || 'cliente'
            }
        });
    } catch (error) {
        const logger = child();
        logger.error('mfa_verify_error', { context: { message: error.message, stack: error.stack } });
        res.status(500).json({ message: 'Error al verificar MFA' });
    }
};

const refresh = async (req, res) => {
    try {
        let { refreshToken } = req.body || {};
        refreshToken = sanitize(refreshToken);
        if (!isNonEmpty(refreshToken)) refreshToken = sanitize(getCookie(req, REFRESH_COOKIE_NAME));
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

        const user = await User.findById(String(decoded.uid)).exec();
        if (!user) return res.status(401).json({ message: 'Refresh token no válido' });

        const tokenHash = sha256(refreshToken);
        const tokens = Array.isArray(user.refreshTokens) ? user.refreshTokens : [];
        const idx = tokens.findIndex(t => t && t.tokenHash === tokenHash);
        
        // Si el token no está en BD, podría ser un intento de reutilización de un token viejo ya rotado
        if (idx === -1) {
            // DETECTAR REUSO: Si el token no está, pero quizás el sid sí está en otros tokens revocados...
            // Por simplicidad, si el token no existe en la lista de activos/recientes, forzamos logout de todas las sesiones del usuario (Detección de Robo)
            user.refreshTokens = []; // Revocación nuclear
            await user.save();
            return res.status(401).json({ message: 'Refresh token inválido o reutilizado. Todas las sesiones han sido cerradas por seguridad.' });
        }

        const entry = tokens[idx];
        const now = new Date();
        
        // Si el token ya fue revocado, sospechamos robo (Re-use detection)
        if (entry.revokedAt) {
            user.refreshTokens = []; // Nuclear
            await user.save();
            return res.status(401).json({ message: 'Refresh token reutilizado. Por seguridad se cerraron todas las sesiones.' });
        }

        if (entry.expiresAt && new Date(entry.expiresAt).getTime() < now.getTime()) {
            return res.status(401).json({ message: 'Refresh token expirado' });
        }

        const currentSessionId = decoded.sid || entry.sessionId || tokenHash;
        
        // ROTACIÓN: Creamos uno nuevo e invalidamos el actual
        const newRefreshToken = createRefreshToken(user, currentSessionId);
        
        // El persistRefreshToken ahora maneja la invalidación del viejo si le pasamos isRotation: true
        await persistRefreshToken({ 
            user, 
            refreshToken: newRefreshToken, 
            req, 
            isRotation: true, 
            oldTokenHash: tokenHash 
        });

        const token = createAccessToken(user);
        if (shouldUseAccessCookie()) setAccessCookie(req, res, token);
        setRefreshCookie(req, res, newRefreshToken);
        return res.json({
            ...(shouldExposeAccessTokenInBody() ? { token } : {}),
            ...(shouldExposeRefreshTokenInBody() ? { refreshToken: newRefreshToken } : {}),
            user: {
                id: String(user._id),
                nombre: user.nombre,
                rol: user.role || 'cliente'
            }
        });
    } catch (error) {
        const logger = child();
        logger.error('refresh_error', { context: { message: error.message, stack: error.stack } });
        res.status(500).json({ message: 'Error al refrescar token' });
    }
};

const logoutApi = async (req, res) => {
    try {
        const tokenFromCookie = sanitize(getCookie(req, REFRESH_COOKIE_NAME));
        if (isNonEmpty(tokenFromCookie)) {
            const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
            let decoded;
            try {
                decoded = jwt.verify(tokenFromCookie, refreshSecret);
            } catch {
                decoded = null;
            }
            if (decoded && decoded.typ === 'refresh' && decoded.uid) {
                const user = await User.findById(String(decoded.uid)).exec();
                if (user) {
                    const tokenHash = sha256(tokenFromCookie);
                    user.refreshTokens = Array.isArray(user.refreshTokens) ? user.refreshTokens : [];
                    const idx = user.refreshTokens.findIndex(t => t && t.tokenHash === tokenHash);
                    if (idx !== -1 && !user.refreshTokens[idx].revokedAt) {
                        user.refreshTokens[idx].revokedAt = new Date();
                        await user.save();
                    }
                }
            }
        }
    } catch {}
    clearAuthCookies(req, res);
    return res.json({ message: 'Sesión cerrada' });
};

/**
 * SSO: Genera un token temporal para "saltar" de App A a App B
 */
const generateSsoToken = async (req, res) => {
    try {
        const user = await User.findById(req.uid).exec();
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

        const ssoSecret = process.env.JWT_SSO_SECRET || process.env.JWT_SECRET;
        const expiresIn = '1m'; // Token muy corto, solo para el intercambio
        const payload = { 
            uid: String(user._id), 
            typ: 'sso_exchange',
            origin: 'AppA'
        };
        const ssoToken = jwt.sign(payload, ssoSecret, { expiresIn });

        const configuredOrigin = String(process.env.FRONTEND_URL || process.env.WEBAUTHN_ORIGIN || process.env.APP_ORIGIN || 'https://farmacia-juan-pablo-ii.web.app')
            .split(',')[0]
            .trim()
            .replace(/\/$/, '');
        const loginUrl = `${configuredOrigin}/acceso-qr?ssoToken=${encodeURIComponent(ssoToken)}`;
        const qrDataUrl = await qrcode.toDataURL(loginUrl, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 360
        });

        res.json({ ssoToken, loginUrl, qrDataUrl, expiresInSeconds: 60 });
    } catch (error) {
        res.status(500).json({ message: 'Error al generar token SSO' });
    }
};

/**
 * SSO: Valida el token temporal y emite una sesión real en App B
 */
/**
 * RECO: Paso 1 - Solicitar recuperación
 */
const requestPasswordRecovery = async (req, res) => {
    try {
        const { email, method } = req.body; // method: 'email', 'sms', 'call'
        const user = await User.findOne({ email }).exec();
        
        if (!user) {
            // Seguridad: Enviar correo de alerta y engañar al frontend
            const logger = child();
            await sendAccountNotFoundEmail({ to: email, action: 'recovery', logger });
            
            // Devolvemos exactamente la misma respuesta que si existiera
            return res.json({ 
                message: 'Código enviado correctamente.', 
                method: method || 'email', 
                expiresIn: '15 min' 
            });
        }

        const now = new Date();
        const cooldown = 5 * 60 * 1000; // 5 minutos entre solicitudes
        if (user.recovery?.lastRequestedAt && (now - user.recovery.lastRequestedAt < cooldown)) {
            return res.status(429).json({ message: 'Debes esperar antes de solicitar otro código.' });
        }

        const token = Math.floor(100000 + Math.random() * 900000).toString(); // 6 dígitos
        const tokenHash = sha256(token);
        const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 min

        user.recovery = {
            ...user.recovery,
            tokenHash,
            tokenExpiresAt: expiresAt,
            tokenAttempts: 0,
            lastRequestedAt: now
        };
        await user.save();
        const recoLogger = child({ userId: String(user._id) });

        // Simulación de envío según método
        if (method === 'sms') {
            console.log(`[SIMULACIÓN SMS] Código de recuperación: ${token}`);
        } else if (method === 'call') {
            console.log(`[SIMULACIÓN LLAMADA] Su código es: ${token.split('').join('... ')}`);
        } else {
            // Método 'email' (o por defecto) - Envío Real
            const sent = await sendRecoveryEmail({ to: email, code: token, logger: recoLogger });
            
            // Si falla el envío y estamos en producción (y no en modo simulación), devolvemos error
            if (!sent && process.env.NODE_ENV === 'production' && !isEmailSimulationEnabled()) {
                return res.status(503).json({ message: 'No se pudo enviar el correo de recuperación. Intenta más tarde.' });
            }
        }

        return res.json({ 
            message: 'Código enviado correctamente.',
            method,
            expiresIn: '15 min'
        });
    } catch (error) {
        res.status(500).json({ message: 'Error al procesar recuperación.' });
    }
};

/**
 * RECO: Paso 2 - Verificar Token y Preguntas Secretas
 */
const verifyRecoveryStep = async (req, res) => {
    try {
        const { email, token, answers } = req.body; // answers: [{ questionId, answer }]
        const user = await User.findOne({ email }).exec();

        if (!user || !user.recovery?.tokenHash) {
            return res.status(400).json({ message: 'Solicitud inválida.' });
        }

        // 1. Validar Bloqueo por intentos
        if (user.recovery.questionsBlockedUntil && user.recovery.questionsBlockedUntil > new Date()) {
            return res.status(403).json({ message: 'Cuenta temporalmente bloqueada por demasiados intentos.' });
        }

        // 2. Validar Token
        if (new Date() > user.recovery.tokenExpiresAt) {
            return res.status(401).json({ message: 'El código ha expirado.' });
        }

        if (user.recovery.tokenAttempts >= 3) {
            return res.status(401).json({ message: 'Demasiados intentos con el código.' });
        }

        if (sha256(token) !== user.recovery.tokenHash) {
            user.recovery.tokenAttempts += 1;
            await user.save();
            return res.status(401).json({ message: 'Código incorrecto.' });
        }

        // 3. Validar Preguntas Secretas (si existen en el modelo para este usuario)
        if (user.recovery.questions && user.recovery.questions.length > 0) {
            if (!answers || answers.length === 0) {
                return res.status(400).json({ message: 'Se requieren respuestas a las preguntas secretas.' });
            }

            for (const q of user.recovery.questions) {
                const provided = answers.find(a => a.questionId === q.questionId);
                if (!provided || sha256(provided.answer.toLowerCase().trim()) !== q.answerHash) {
                    q.attempts += 1;
                    if (q.attempts >= 3) {
                        user.recovery.questionsBlockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 min bloqueo
                    }
                    await user.save();
                    return res.status(401).json({ message: 'Respuestas de seguridad incorrectas.' });
                }
            }
        }

        // Si todo OK, generamos un JWT de un solo uso para permitir el cambio de password
        const resetSecret = process.env.JWT_SECRET + user.password; // Sal única
        const resetToken = jwt.sign({ uid: user._id, type: 'reset' }, resetSecret, { expiresIn: '10m' });

        return res.json({ 
            message: 'Validación exitosa.',
            resetToken 
        });
    } catch (error) {
        res.status(500).json({ message: 'Error en la validación.' });
    }
};


const resetPassword = async (req, res) => {
    try {
        const { email, resetToken, newPassword } = req.body;
        const user = await User.findOne({ email }).exec();

        if (!user) return res.status(400).json({ message: 'Usuario no encontrado.' });

        const resetSecret = process.env.JWT_SECRET + user.password;
        let decoded;
        try {
            decoded = jwt.verify(resetToken, resetSecret);
        } catch (e) {
            return res.status(401).json({ message: 'Token de reseteo inválido o expirado.' });
        }

        if (decoded.uid !== String(user._id) || decoded.type !== 'reset') {
            return res.status(401).json({ message: 'Token inválido.' });
        }

        // Cambiar password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        
        // Limpiar tokens de recuperación e invalidar sesiones actuales
        user.recovery.tokenHash = null;
        user.recovery.tokenExpiresAt = null;
        user.refreshTokens = []; 
        
        await user.save();

        return res.json({ message: 'Contraseña actualizada con éxito.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar contraseña.' });
    }
};

const validateSsoToken = async (req, res) => {
    try {
        const { ssoToken } = req.body;
        if (!ssoToken) return res.status(400).json({ message: 'Falta ssoToken' });

        const ssoSecret = process.env.JWT_SSO_SECRET || process.env.JWT_SECRET;
        let decoded;
        try {
            decoded = jwt.verify(ssoToken, ssoSecret);
        } catch (err) {
            return res.status(401).json({ message: 'Token SSO inválido o expirado' });
        }

        if (decoded.typ !== 'sso_exchange') {
            return res.status(401).json({ message: 'Tipo de token inválido' });
        }

        const user = await User.findById(decoded.uid).exec();
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

        // Emitir nuevos tokens de sesión para App B
        const token = createAccessToken(user);
        const refreshToken = createRefreshToken(user);
        await persistRefreshToken({ user, refreshToken, req });

        res.json({
            message: 'SSO Exitoso',
            token,
            refreshToken,
            user: {
                id: String(user._id),
                nombre: user.nombre,
                rol: user.role || 'cliente'
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error al validar token SSO' });
    }
};

function bufferToBase64url(buffer) {
    if (buffer === undefined || buffer === null) {
        throw new TypeError('buffer_to_base64url_invalid_input');
    }
    if (typeof buffer === 'string') {
        return buffer;
    }
    const b64 = Buffer.from(buffer).toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlToBuffer(base64url) {
    const b64 = String(base64url || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    return Buffer.from(b64 + pad, 'base64');
}

function getWebauthnConfig(req) {
    const rpName = process.env.WEBAUTHN_RP_NAME || 'SFJPII';
    const allowedOriginsRaw = process.env.WEBAUTHN_ALLOWED_ORIGINS || process.env.WEBAUTHN_ORIGIN || process.env.APP_ORIGIN || 'http://localhost:8100';
    const webOrigins = String(allowedOriginsRaw)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    // Origen de la APK de desarrollo firmado con el certificado actual. En una
    // publicación de Play Store se agrega también el origen de la firma de Play
    // mediante WEBAUTHN_ANDROID_ORIGINS (separado por comas).
    const defaultAndroidOrigin = 'android:apk-key-hash:1Sc1YenxOv_9cZZcCfIzyd5GUtfHQWOok7vJKQDT7lQ';
    const androidOrigins = String(process.env.WEBAUTHN_ANDROID_ORIGINS || defaultAndroidOrigin)
        .split(',')
        .map(s => s.trim())
        .filter(s => s.startsWith('android:apk-key-hash:'));
    const allowedOrigins = [...new Set([...webOrigins, ...androidOrigins])];

    const requestOrigin = String(req?.headers?.origin || '').trim();
    const origin = requestOrigin && webOrigins.includes(requestOrigin) ? requestOrigin : (webOrigins[0] || 'http://localhost:8100');

    let rpID = process.env.WEBAUTHN_RP_ID;
    if (!rpID) rpID = new URL(origin).hostname;
    const challengeSecret = process.env.WEBAUTHN_CHALLENGE_SECRET || process.env.JWT_SECRET;
    return { rpName, origin, allowedOrigins, rpID, challengeSecret };
}

function createWebauthnChallengeToken({ challenge, email, mode, origin, allowedOrigins, rpID }) {
    const { challengeSecret } = getWebauthnConfig();
    const payload = {
        typ: 'webauthn_challenge',
        mode,
        challenge,
        origin,
        allowedOrigins,
        rpID,
        email: email ? String(email).toLowerCase() : undefined
    };
    return jwt.sign(payload, challengeSecret, { expiresIn: process.env.WEBAUTHN_CHALLENGE_EXPIRES_IN || '5m' });
}

function verifyWebauthnChallengeToken(token) {
    const { challengeSecret } = getWebauthnConfig();
    const decoded = jwt.verify(token, challengeSecret);
    if (!decoded || decoded.typ !== 'webauthn_challenge' || !decoded.challenge) {
        throw new Error('webauthn_challenge_invalid');
    }
    return decoded;
}

const webauthnBeginRegistration = async (req, res) => {
    try {
        const uid = String(req.uid || '');
        if (!uid) return res.status(401).json({ message: 'No autorizado' });

        const user = await User.findById(uid).exec();
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
        if (!user.isVerified) return res.status(403).json({ message: 'Debes verificar tu correo primero.' });

        const { rpName, rpID, origin, allowedOrigins } = getWebauthnConfig(req);

        const credentials = Array.isArray(user?.webauthn?.credentials) ? user.webauthn.credentials : [];
        const excludeCredentials = credentials.map((c) => ({
            id: String(c.credentialID),
            type: 'public-key',
            transports: Array.isArray(c.transports) ? c.transports : undefined
        }));

        const options = await generateRegistrationOptions({
            rpName,
            rpID,
            userID: Buffer.from(String(user._id)),
            userName: String(user.email).toLowerCase(),
            userDisplayName: `${user.nombre || ''} ${user.apellido || ''}`.trim() || String(user.email).toLowerCase(),
            timeout: Number(process.env.WEBAUTHN_TIMEOUT_MS) || 60_000,
            attestationType: 'none',
            excludeCredentials,
            authenticatorSelection: {
                userVerification: 'required',
                residentKey: 'preferred'
            }
        });

        user.webauthn = user.webauthn || {};
        user.webauthn.currentChallenge = options.challenge;
        await user.save();

        const webauthnToken = createWebauthnChallengeToken({ challenge: options.challenge, email: user.email, mode: 'register', origin, allowedOrigins, rpID });
        return res.json({ options, webauthnToken });
    } catch (error) {
        const logger = child();
        logger.error('webauthn_begin_registration_error', { context: { message: error.message, stack: error.stack } });
        return res.status(500).json({ message: 'No se pudo iniciar el registro de passkey' });
    }
};

const webauthnFinishRegistration = async (req, res) => {
    try {
        const uid = String(req.uid || '');
        if (!uid) return res.status(401).json({ message: 'No autorizado' });

        const { credential, webauthnToken, name } = req.body || {};
        if (!credential || !webauthnToken) {
            return res.status(400).json({ message: 'Datos inválidos.' });
        }

        const decoded = verifyWebauthnChallengeToken(webauthnToken);
        if (decoded.mode !== 'register') {
            return res.status(400).json({ message: 'Token inválido.' });
        }

        const user = await User.findById(uid).exec();
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
        if (!user?.webauthn?.currentChallenge) {
            return res.status(400).json({ message: 'No hay un registro de passkey pendiente.' });
        }

        const { origin, allowedOrigins, rpID } = decoded?.origin && decoded?.rpID
            ? { origin: decoded.origin, allowedOrigins: decoded.allowedOrigins, rpID: decoded.rpID }
            : getWebauthnConfig(req);
        const expectedChallenge = String(user.webauthn.currentChallenge);

        const verification = await verifyRegistrationResponse({
            response: credential,
            expectedChallenge,
            expectedOrigin: Array.isArray(allowedOrigins) && allowedOrigins.length ? allowedOrigins : origin,
            expectedRPID: rpID,
            requireUserVerification: true
        });

        if (!verification.verified || !verification.registrationInfo) {
            return res.status(400).json({ message: 'No se pudo verificar la passkey.' });
        }

        const registrationInfo = verification.registrationInfo;
        const credentialIDRaw =
            registrationInfo.credentialID ??
            registrationInfo.credentialId ??
            registrationInfo.credential?.id ??
            registrationInfo.credential?.credentialID ??
            registrationInfo.credential?.credentialId ??
            registrationInfo.id;
        const credentialPublicKeyRaw =
            registrationInfo.credentialPublicKey ??
            registrationInfo.credential?.publicKey ??
            registrationInfo.credential?.credentialPublicKey ??
            registrationInfo.credential?.credentialPublicKeyPem ??
            registrationInfo.publicKey;
        const counterRaw = registrationInfo.counter ?? registrationInfo.credential?.counter ?? 0;

        if (!credentialIDRaw || !credentialPublicKeyRaw) {
            return res.status(400).json({ message: 'Respuesta de passkey incompleta.' });
        }

        const credentialIDb64 = bufferToBase64url(credentialIDRaw);
        const credentialPublicKeyB64 = bufferToBase64url(credentialPublicKeyRaw);

        user.webauthn.credentials = Array.isArray(user.webauthn.credentials) ? user.webauthn.credentials : [];
        const exists = user.webauthn.credentials.some(c => c.credentialID === credentialIDb64);
        if (!exists) {
            const transportsRaw = credential?.response?.transports ?? credential?.transports;
            const transports = Array.isArray(transportsRaw)
                ? transportsRaw
                : (transportsRaw && typeof transportsRaw === 'object')
                    ? Object.values(transportsRaw).map(v => String(v))
                    : (typeof transportsRaw === 'string')
                        ? [transportsRaw]
                        : [];

            user.webauthn.credentials.push({
                credentialID: credentialIDb64,
                credentialPublicKey: credentialPublicKeyB64,
                counter: Number(counterRaw) || 0,
                transports,
                name: String(sanitize(name) || 'Mi passkey').slice(0, 60),
                createdAt: new Date()
            });
        }

        user.webauthn.currentChallenge = undefined;
        await user.save();

        return res.json({ message: 'Passkey registrada correctamente' });
    } catch (error) {
        const logger = child();
        logger.error('webauthn_finish_registration_error', { context: { message: error.message, stack: error.stack } });
        return res.status(500).json({ message: 'No se pudo finalizar el registro de passkey' });
    }
};

const webauthnBeginLogin = async (req, res) => {
    try {
        let { email } = req.body || {};
        email = sanitize(email);
        const normalizedEmail = isEmail(email) ? String(email).toLowerCase() : null;

        const { rpID, origin, allowedOrigins } = getWebauthnConfig(req);

        let user = null;
        let allowCredentials = undefined;
        if (normalizedEmail) {
            user = await User.findOne({ email: normalizedEmail }).exec();
            if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
            if (!user.isVerified) return res.status(403).json({ message: 'Debes verificar tu correo primero.' });

            const creds = Array.isArray(user?.webauthn?.credentials) ? user.webauthn.credentials : [];
            if (!creds.length) return res.status(400).json({ message: 'Este usuario no tiene passkeys registradas.' });

            allowCredentials = creds.map(c => ({
                id: String(c.credentialID),
                type: 'public-key',
                transports: Array.isArray(c.transports) ? c.transports : undefined
            }));
        }

        const options = await generateAuthenticationOptions({
            rpID,
            allowCredentials,
            timeout: Number(process.env.WEBAUTHN_TIMEOUT_MS) || 60_000,
            userVerification: 'required'
        });

        if (user) {
            user.webauthn = user.webauthn || {};
            user.webauthn.currentChallenge = options.challenge;
            await user.save();
        }

        const webauthnToken = createWebauthnChallengeToken({
            challenge: options.challenge,
            email: normalizedEmail || undefined,
            mode: 'login',
            origin,
            allowedOrigins,
            rpID
        });

        return res.json({ options, webauthnToken });
    } catch (error) {
        const logger = child();
        logger.error('webauthn_begin_login_error', { context: { message: error.message, stack: error.stack } });
        return res.status(500).json({ message: 'No se pudo iniciar el login con passkey' });
    }
};

const webauthnFinishLogin = async (req, res) => {
    try {
        const { credential, webauthnToken } = req.body || {};
        if (!credential || !webauthnToken) {
            return res.status(400).json({ message: 'Datos inválidos.' });
        }

        const decoded = verifyWebauthnChallengeToken(webauthnToken);
        if (decoded.mode !== 'login') {
            return res.status(400).json({ message: 'Token inválido.' });
        }

        const expectedChallenge = String(decoded.challenge);
        const normalizedEmail = decoded.email ? String(decoded.email).toLowerCase() : null;
        const credentialIdFromClient = credential?.id ? String(credential.id) : null;
        if (!credentialIdFromClient) {
            return res.status(400).json({ message: 'Credencial inválida.' });
        }

        let user;
        if (normalizedEmail) {
            user = await User.findOne({ email: normalizedEmail }).exec();
        } else {
            user = await User.findOne({ 'webauthn.credentials.credentialID': credentialIdFromClient }).exec();
        }
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
        if (!user.isVerified) return res.status(403).json({ message: 'Debes verificar tu correo primero.' });

        const creds = Array.isArray(user?.webauthn?.credentials) ? user.webauthn.credentials : [];
        const stored = creds.find(c => c.credentialID === credentialIdFromClient);
        if (!stored) return res.status(400).json({ message: 'Passkey no registrada.' });

        const { origin, allowedOrigins, rpID } = decoded?.origin && decoded?.rpID
            ? { origin: decoded.origin, allowedOrigins: decoded.allowedOrigins, rpID: decoded.rpID }
            : getWebauthnConfig(req);
        const webauthnCredential = {
            id: String(stored.credentialID),
            publicKey: base64urlToBuffer(stored.credentialPublicKey),
            counter: Number(stored.counter) || 0,
            transports: Array.isArray(stored.transports) ? stored.transports : undefined
        };

        const verification = await verifyAuthenticationResponse({
            response: credential,
            expectedChallenge,
            expectedOrigin: Array.isArray(allowedOrigins) && allowedOrigins.length ? allowedOrigins : origin,
            expectedRPID: rpID,
            credential: webauthnCredential,
            requireUserVerification: true
        });

        if (!verification.verified || !verification.authenticationInfo) {
            return res.status(400).json({ message: 'No se pudo verificar la passkey.' });
        }

        stored.counter = Number(verification.authenticationInfo.newCounter) || stored.counter;
        stored.lastUsedAt = new Date();
        user.webauthn.currentChallenge = undefined;
        await user.save();

        const token = createAccessToken(user);
        const refreshToken = createRefreshToken(user);
        await persistRefreshToken({ user, refreshToken, req });

        setRefreshCookie(req, res, refreshToken);
        if (shouldUseAccessCookie()) setAccessCookie(req, res, token);

        return res.json({
            message: 'Bienvenido',
            ...(shouldExposeAccessTokenInBody() ? { token } : {}),
            ...(shouldExposeRefreshTokenInBody() ? { refreshToken } : {}),
            user: {
                id: String(user._id),
                nombre: user.nombre,
                rol: user.role || 'cliente'
            }
        });
    } catch (error) {
        const logger = child();
        logger.error('webauthn_finish_login_error', { context: { message: error.message, stack: error.stack } });
        return res.status(500).json({ message: 'No se pudo finalizar el login con passkey' });
    }
};

const webauthnListCredentials = async (req, res) => {
    try {
        const uid = String(req.uid || '');
        if (!uid) return res.status(401).json({ message: 'No autorizado' });

        const user = await User.findById(uid).exec();
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

        const creds = Array.isArray(user?.webauthn?.credentials) ? user.webauthn.credentials : [];
        return res.json({
            credentials: creds.map(c => ({
                credentialID: c.credentialID,
                name: c.name || 'Mi passkey',
                transports: Array.isArray(c.transports) ? c.transports : [],
                createdAt: c.createdAt || null,
                lastUsedAt: c.lastUsedAt || null
            }))
        });
    } catch (error) {
        const logger = child();
        logger.error('webauthn_list_credentials_error', { context: { message: error.message, stack: error.stack } });
        return res.status(500).json({ message: 'No se pudieron listar las passkeys' });
    }
};

const webauthnRenameCredential = async (req, res) => {
    try {
        const uid = String(req.uid || '');
        let { credentialID, name } = req.body || {};
        name = String(sanitize(name) || '').slice(0, 60);
        if (!uid) return res.status(401).json({ message: 'No autorizado' });
        if (!credentialID || !name) return res.status(400).json({ message: 'Escribe un nombre para la passkey.' });

        const user = await User.findById(uid).exec();
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
        const credential = (user?.webauthn?.credentials || []).find(c => c.credentialID === String(credentialID));
        if (!credential) return res.status(404).json({ message: 'Passkey no encontrada' });
        credential.name = name;
        await user.save();
        return res.json({ message: 'Nombre de passkey actualizado' });
    } catch (error) {
        child().error('webauthn_rename_credential_error', { context: { message: error.message } });
        return res.status(500).json({ message: 'No se pudo renombrar la passkey' });
    }
};

const googleLogin = async (req, res) => {
    try {
        const credential = String(req.body?.credential || '');
        const clientId = String(process.env.GOOGLE_CLIENT_ID || '');
        if (!credential || !clientId) return res.status(400).json({ message: 'Inicio con Google no configurado.' });

        const { data } = await axios.get('https://oauth2.googleapis.com/tokeninfo', { params: { id_token: credential }, timeout: 10000 });
        if (String(data?.aud || '') !== clientId || String(data?.email_verified) !== 'true' || !isEmail(data?.email)) {
            return res.status(401).json({ message: 'La cuenta de Google no pudo verificarse.' });
        }

        const email = String(data.email).toLowerCase();
        let user = await User.findOne({ email }).exec();
        if (!user) {
            const generatedPassword = crypto.randomBytes(32).toString('hex') + 'A1!';
            user = await User.create({
                nombre: String(data.given_name || data.name || 'Usuario').slice(0, 80),
                apellido: String(data.family_name || 'Google').slice(0, 80),
                email,
                password: await bcrypt.hash(generatedPassword, 10),
                passwordConfigured: false,
                isVerified: true,
                foto_perfil: data.picture,
                authProviders: { google: { sub: String(data.sub), connectedAt: new Date() } }
            });
        } else {
            user.isVerified = true;
            user.authProviders = user.authProviders || {};
            user.authProviders.google = { sub: String(data.sub), connectedAt: user.authProviders?.google?.connectedAt || new Date() };
            await user.save();
        }

        const token = createAccessToken(user);
        const refreshToken = createRefreshToken(user);
        await persistRefreshToken({ user, refreshToken, req });
        setRefreshCookie(req, res, refreshToken);
        if (shouldUseAccessCookie()) setAccessCookie(req, res, token);
        return res.json({
            message: 'Bienvenido', token, refreshToken,
            requiresLocation: (user.ubicaciones || []).length === 0,
            user: { id: String(user._id), nombre: user.nombre, apellido: user.apellido, email: user.email, rol: user.role || 'cliente' }
        });
    } catch (error) {
        child().error('google_login_error', { context: { message: error.message } });
        return res.status(401).json({ message: 'No se pudo iniciar sesión con Google.' });
    }
};

const webauthnDeleteCredentials = async (req, res) => {
    try {
        const uid = String(req.uid || '');
        if (!uid) return res.status(401).json({ message: 'No autorizado' });

        let { credentialID } = req.body || {};
        credentialID = sanitize(credentialID);

        const user = await User.findById(uid).exec();
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

        user.webauthn = user.webauthn || {};
        const creds = Array.isArray(user.webauthn.credentials) ? user.webauthn.credentials : [];

        if (credentialID) {
            user.webauthn.credentials = creds.filter(c => c.credentialID !== String(credentialID));
        } else {
            user.webauthn.credentials = [];
        }
        await user.save();

        return res.json({ message: 'Passkeys eliminadas' });
    } catch (error) {
        const logger = child();
        logger.error('webauthn_delete_credentials_error', { context: { message: error.message, stack: error.stack } });
        return res.status(500).json({ message: 'No se pudieron eliminar las passkeys' });
    }
};

module.exports = {
    register,
    verifyCode,
    resendVerifyCode,
    login,
    resendMfaOtp,
    verifyMfa,
    refresh,
    logoutApi,
    generateSsoToken,
    validateSsoToken,
    webauthnBeginRegistration,
    webauthnFinishRegistration,
    webauthnRenameCredential,
    webauthnBeginLogin,
    webauthnFinishLogin,
    webauthnListCredentials,
    webauthnDeleteCredentials,
    googleLogin,
    requestPasswordRecovery,
    verifyRecoveryStep,
    resetPassword
};
