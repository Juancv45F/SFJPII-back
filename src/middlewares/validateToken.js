const jwt = require('jsonwebtoken');

const validateToken = (req, res, next) => {
    // Obtener el token del encabezado (Header)
    // Se espera que venga así: "x-token": "eyJhbGciOiJIUz..."
    const fromXToken = req.header('x-token');
    const authorization = req.header('authorization');
    const fromAuthorization =
        typeof authorization === 'string' && authorization.toLowerCase().startsWith('bearer ')
            ? authorization.slice(7).trim()
            : authorization;
    const token = fromXToken || fromAuthorization;

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
