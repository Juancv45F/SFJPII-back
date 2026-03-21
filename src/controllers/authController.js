const mongoose = require('mongoose');
const User = require('../models-mongo/user');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { child } = require('../utils/logger');

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isStrongPassword = (v) => v && v.length >= 8 && /[A-Z]/.test(v) && /\d/.test(v) && /[\W_]/.test(v);
const sanitize = (v) => typeof v === 'string' ? v.trim() : v;
const isNonEmpty = (v) => typeof v === 'string' ? v.trim().length > 0 : v !== undefined && v !== null;
const isLettersSpaces = (v) => /^[A-Za-zÀ-ÖØ-öø-ÿ\s]+$/.test(v);

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const resendCooldownMs = Number(process.env.RESEND_COOLDOWN_MS) || 60 * 1000;

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

async function sendOtpEmail({ to, code, logger }) {
    let sentByEmail = false;
    try {
        if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
            const port = Number(process.env.SMTP_PORT) || 587;
            const secure = typeof process.env.SMTP_SECURE === 'string'
                ? process.env.SMTP_SECURE === 'true'
                : port === 465;
            const requireTLS = process.env.SMTP_REQUIRE_TLS === 'true';
            const rejectUnauthorized = process.env.SMTP_REJECT_UNAUTHORIZED === 'false' ? false : undefined;
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port,
                secure,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                },
                requireTLS,
                tls: rejectUnauthorized === undefined ? undefined : { rejectUnauthorized }
            });
            await transporter.verify();
            const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;
            const fromName = process.env.SMTP_FROM_NAME;
            const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
            const info = await transporter.sendMail({
                from,
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
        logger.error('mfa_email_send_failed', { context: { message: err.message, code: err.code, response: err.response, command: err.command } });
        sentByEmail = false;
    }
    if (!sentByEmail) {
        console.log('=============================================');
        console.log(`📲  [OTP SIMULADO] Mensaje para ${to}:`);
        console.log(`🔐  Tu código OTP es: ${code}`);
        console.log('=============================================');
    }
}

async function sendVerificationEmail({ to, code, logger }) {
    let sentByEmail = false;
    try {
        if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
            const port = Number(process.env.SMTP_PORT) || 587;
            const secure = typeof process.env.SMTP_SECURE === 'string'
                ? process.env.SMTP_SECURE === 'true'
                : port === 465;
            const requireTLS = process.env.SMTP_REQUIRE_TLS === 'true';
            const rejectUnauthorized = process.env.SMTP_REJECT_UNAUTHORIZED === 'false' ? false : undefined;
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port,
                secure,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                },
                requireTLS,
                tls: rejectUnauthorized === undefined ? undefined : { rejectUnauthorized }
            });
            await transporter.verify();
            const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;
            const fromName = process.env.SMTP_FROM_NAME;
            const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
            const info = await transporter.sendMail({
                from,
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
        logger.error('verify_email_send_failed', { context: { message: err.message, code: err.code, response: err.response, command: err.command } });
        sentByEmail = false;
    }
    if (!sentByEmail) {
        console.log('=============================================');
        console.log(`✉️  [EMAIL SIMULADO] Mensaje para ${to}:`);
        console.log(`🔐  Tu código de verificación es: ${code}`);
        console.log('=============================================');
    }
}

async function persistRefreshToken({ user, refreshToken, req }) {
    const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    const decoded = jwt.verify(refreshToken, refreshSecret);
    const expMs = decoded && decoded.exp ? decoded.exp * 1000 : (Date.now() + 7 * 24 * 60 * 60 * 1000);
    const tokenHash = sha256(refreshToken);
    const sessionId = decoded && decoded.sid ? String(decoded.sid) : (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
    const userAgent = req?.header?.('user-agent') || req?.headers?.['user-agent'];
    const ip = (req && (req.ip || req.headers?.['x-forwarded-for'])) ? String(req.headers?.['x-forwarded-for'] || req.ip) : undefined;
    user.refreshTokens = Array.isArray(user.refreshTokens) ? user.refreshTokens : [];
    user.refreshTokens.push({
        sessionId,
        tokenHash,
        expiresAt: new Date(expMs),
        lastUsedAt: new Date(),
        userAgent: userAgent ? String(userAgent) : undefined,
        ip: ip ? String(ip) : undefined
    });
    const maxTokens = Number(process.env.JWT_REFRESH_MAX_TOKENS) || 10;
    if (user.refreshTokens.length > maxTokens) {
        user.refreshTokens.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
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
        const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${recaptchaToken}`;
        
        // Descomentar para producción:
        const googleResponse = await axios.post(verifyUrl);
        if (!googleResponse.data.success) {
            await t.rollback();
            return res.status(400).json({ message: 'Captcha inválido' });
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
        await sendVerificationEmail({ to: email, code: emailCode, logger: regLogger });

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
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
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
        await sendVerificationEmail({ to: user.email, code, logger });
        return res.json({ message: 'Código reenviado', retryAfterSec: Math.ceil(resendCooldownMs / 1000) });
    } catch (error) {
        const logger = child();
        logger.error('resend_verify_error', { context: { message: error.message, stack: error.stack } });
        res.status(500).json({ message: 'Error al reenviar código' });
    }
};

// LOGIN (Para entrar después de verificar)
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

        // Verificar contraseña
        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(400).json({ message: 'Credenciales inválidas' });

        if (user?.mfa?.enabled) {
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

            const loginLogger = child({ userId: String(user._id) });
            await sendOtpEmail({ to: user.email, code: otp, logger: loginLogger });

            const mfaToken = createMfaToken(user);
            return res.json({
                message: 'Se requiere verificación MFA',
                mfaRequired: true,
                mfaToken,
                email: user.email
            });
        }

        const token = createAccessToken(user);
        const refreshToken = createRefreshToken(user);
        await persistRefreshToken({ user, refreshToken, req });

        res.json({
            message: 'Bienvenido',
            token,
            refreshToken,
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
        let { mfaToken } = req.body || {};
        mfaToken = sanitize(mfaToken);
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
        await sendOtpEmail({ to: user.email, code: otp, logger });
        return res.json({ message: 'OTP reenviado', retryAfterSec: Math.ceil(resendCooldownMs / 1000) });
    } catch (error) {
        const logger = child();
        logger.error('resend_mfa_error', { context: { message: error.message, stack: error.stack } });
        res.status(500).json({ message: 'Error al reenviar OTP' });
    }
};

const verifyMfa = async (req, res) => {
    try {
        let { mfaToken, otp } = req.body || {};
        mfaToken = sanitize(mfaToken);
        otp = sanitize(otp);
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

        const now = new Date();
        const otpExpiresAt = user?.mfa?.otpExpiresAt ? new Date(user.mfa.otpExpiresAt) : null;
        if (!user?.mfa?.otpHash || !otpExpiresAt || otpExpiresAt.getTime() < now.getTime()) {
            return res.status(400).json({ message: 'OTP expirado o no solicitado' });
        }
        const maxAttempts = Number(process.env.MFA_OTP_MAX_ATTEMPTS) || 5;
        const attempts = Number(user?.mfa?.otpAttempts || 0);
        if (attempts >= maxAttempts) {
            return res.status(429).json({ message: 'Demasiados intentos' });
        }

        const ok = await bcrypt.compare(String(otp), String(user.mfa.otpHash));
        if (!ok) {
            user.mfa.otpAttempts = attempts + 1;
            await user.save();
            return res.status(400).json({ message: 'OTP incorrecto' });
        }

        user.mfa.otpHash = undefined;
        user.mfa.otpExpiresAt = undefined;
        user.mfa.otpAttempts = 0;
        await user.save();

        const token = createAccessToken(user);
        const refreshToken = createRefreshToken(user);
        await persistRefreshToken({ user, refreshToken, req });

        return res.json({
            message: 'Bienvenido',
            token,
            refreshToken,
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
        if (!isNonEmpty(refreshToken)) {
            return res.status(400).json({ message: 'Falta refreshToken' });
        }

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
        if (idx === -1) return res.status(401).json({ message: 'Refresh token revocado' });

        const entry = tokens[idx];
        const now = new Date();
        if (entry.revokedAt) return res.status(401).json({ message: 'Refresh token revocado' });
        if (entry.expiresAt && new Date(entry.expiresAt).getTime() < now.getTime()) {
            return res.status(401).json({ message: 'Refresh token expirado' });
        }

        const currentSessionId = decoded.sid || entry.sessionId || tokenHash;
        if (!user.refreshTokens[idx].sessionId) {
            user.refreshTokens[idx].sessionId = String(currentSessionId);
        }
        const newRefreshToken = createRefreshToken(user, currentSessionId);
        const newHash = sha256(newRefreshToken);
        user.refreshTokens[idx].revokedAt = now;
        user.refreshTokens[idx].replacedByTokenHash = newHash;
        user.refreshTokens[idx].lastUsedAt = now;
        await persistRefreshToken({ user, refreshToken: newRefreshToken, req });

        const token = createAccessToken(user);
        return res.json({ token, refreshToken: newRefreshToken });
    } catch (error) {
        const logger = child();
        logger.error('refresh_error', { context: { message: error.message, stack: error.stack } });
        res.status(500).json({ message: 'Error al refrescar token' });
    }
};

module.exports = {
    register,
    verifyCode,
    resendVerifyCode,
    login,
    resendMfaOtp,
    verifyMfa,
    refresh
};
