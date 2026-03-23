const rateLimit = require('express-rate-limit');

// Limitador general para todas las peticiones
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // Limita cada IP a 100 peticiones por ventana
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
