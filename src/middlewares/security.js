const rateLimit = require('express-rate-limit');

// Limitador general para todas las peticiones
const generalLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutos
    max: 500, // Limita cada IP a 500 peticiones por ventana (ajustado para catálogo/búsqueda)
    message: {
        message: 'Demasiadas peticiones desde esta IP, por favor intente de nuevo más tarde.'
    },
    standardHeaders: true, // Retorna info del límite en los headers `RateLimit-*`
    legacyHeaders: false, // Desactiva los headers `X-RateLimit-*`
});

// Limitador más estricto para el login y registro (prevención de fuerza bruta)
const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 10, // Limita cada IP a 10 intentos por hora
    message: {
        message: 'Demasiados intentos de inicio de sesión o registro, por favor intente de nuevo en una hora.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    generalLimiter,
    authLimiter
};
