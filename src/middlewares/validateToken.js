const jwt = require('jsonwebtoken');
const User = require('../models-mongo/user');

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

const validateToken = async (req, res, next) => {
    // Obtener el token del encabezado (Header)
    // Se espera que venga así: "x-token": "eyJhbGciOiJIUz..."
    const fromXToken = req.header('x-token');
    const authorization = req.header('authorization');
    const fromAuthorization =
        typeof authorization === 'string' && authorization.toLowerCase().startsWith('bearer ')
            ? authorization.slice(7).trim()
            : authorization;
    let token = fromXToken || fromAuthorization;
    const useAccessCookie = String(process.env.AUTH_USE_ACCESS_COOKIE || 'false').toLowerCase() === 'true';
    if (!token && useAccessCookie) token = getCookie(req, ACCESS_COOKIE_NAME);

    if (!token) {
        return res.status(401).json({ message: 'No hay token en la petición' });
    }

    try {
        // Verificar la firma del token
        const { uid, rol } = jwt.verify(token, process.env.JWT_SECRET);

        // Inyectar los datos del usuario en la petición
        // Así los siguientes controladores sabrán quién es el usuario
        req.uid = uid;
        req.rol = rol;

        const user = await User.findById(String(uid)).select('role access').exec();
        if (!user) {
            return res.status(401).json({ message: 'Token no válido' });
        }

        const status = String(user?.access?.status || 'active').toLowerCase();
        const suspendedUntil = user?.access?.suspendedUntil ? new Date(user.access.suspendedUntil) : null;
        const disabledAt = user?.access?.disabledAt ? new Date(user.access.disabledAt) : null;

        if (status === 'disabled' || disabledAt) {
            return res.status(403).json({ message: 'Tu cuenta está deshabilitada' });
        }

        if (status === 'suspended') {
            if (suspendedUntil && suspendedUntil.getTime() > Date.now()) {
                return res.status(403).json({
                    message: 'Tu cuenta está suspendida temporalmente',
                    suspendedUntil
                });
            }
            user.access = user.access || {};
            user.access.status = 'active';
            user.access.suspendedUntil = undefined;
            await user.save();
        }

        req.rol = user.role;

        next(); // ¡Pase usted!

    } catch (error) {
        return res.status(401).json({ message: 'Token no válido' });
    }
};

const authorizeRoles = (...allowedRoles) => {
    const normalizedAllowed = allowedRoles
        .flat()
        .map(r => String(r || '').trim().toLowerCase())
        .filter(Boolean);

    return (req, res, next) => {
        const role = String(req.rol || '').trim().toLowerCase();
        if (!role) {
            return res.status(403).json({ message: 'No tienes permisos para realizar esta acción' });
        }
        if (role === 'super_admin') return next();
        if (normalizedAllowed.length === 0) return next();
        if (!normalizedAllowed.includes(role)) {
            return res.status(403).json({ message: 'No tienes permisos para realizar esta acción' });
        }
        return next();
    };
};

module.exports = {
    validateToken,
    authorizeRoles
};
