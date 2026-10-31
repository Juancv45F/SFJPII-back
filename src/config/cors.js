// Allow-list de orígenes para CORS (HTTP y Socket.io).
// Nunca reflejar el Origin: solo se aceptan los orígenes listados en CORS_ORIGINS
// (separados por comas). Sin la variable se usan los orígenes conocidos de dev/prod.
const DEFAULT_ORIGINS = [
    'http://localhost:8100',                    // dev Ionic
    'http://localhost:4200',                    // dev Angular
    'https://localhost',                        // Capacitor Android
    'capacitor://localhost',                    // Capacitor iOS
    'https://farmacia-juan-pablo-ii.web.app',   // prod
];

const allowedOrigins = String(process.env.CORS_ORIGINS || DEFAULT_ORIGINS.join(','))
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(s => s && s !== '*');

function isOriginAllowed(origin) {
    return allowedOrigins.includes(origin);
}

// Peticiones sin Origin (curl, Postman, apps nativas, server-to-server) no son
// un vector CSRF/cross-site, se dejan pasar. Un Origin no listado no recibe
// cabeceras CORS y el navegador bloquea la respuesta.
function corsOrigin(origin, cb) {
    if (!origin || isOriginAllowed(origin)) return cb(null, true);
    return cb(null, false);
}

const corsOptions = {
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-token',
        'x-refresh-token',
        'x-correlation-id'
    ]
};

module.exports = { allowedOrigins, isOriginAllowed, corsOrigin, corsOptions };
