require('dotenv').config(); // variables de entorno
const express = require ('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const { connect } = require('./src/config/mongoose');
const { generalLimiter } = require('./src/middlewares/security');
const productRoutes = require('./src/routes/productRoutes');
const authRoutes = require('./src/routes/authRoutes');
const pedidoRoutes = require('./src/routes/pedidosRoutes');
const ubicacionesRoutes = require('./src/routes/ubicacionesRoutes')
const carritoRoutes = require('./src/routes/carritoRoutes')
const userRoutes = require('./src/routes/userRoutes');
const path = require('path');
const { requestLogger, errorHandler } = require('./src/middlewares/logging');
const { child } = require('./src/utils/logger');
const session = require('express-session');
const superAdminRoutes = require('./src/routes/superAdminRoutes');



const app = express();
app.set('etag', false);
app.set('trust proxy', 1); // Confía en el primer proxy (necesario para Render/Heroku)
app.set('views', path.join(__dirname, 'src/views'));
app.set('view engine', 'pug');

// 1. CONFIGURACIÓN DE CORS (DEBE IR ANTES DE LOS RATE LIMITERS)
app.use(cors({
    origin: true, // Refleja el origen de la petición si coincide (útil para desarrollo y localhost)
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-token',
        'x-refresh-token',
        'x-correlation-id'
    ]
})); 

// 2. SEGURIDAD EXTRA (HELMET)
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
})); 

// 3. PROTECCIÓN CONTRA DOS / RATE LIMITING
app.use(generalLimiter); 

app.use(express.json()); // Que entienda json
app.use(express.urlencoded({ extended: false }));
app.use(requestLogger); // Correlación y métricas de request

// Servir archivos estáticos de la carpeta uploads
app.use('/uploads', express.static(path.join(__dirname, 'src/public/uploads')));
// Servir dashboard público y archivos estáticos generales
app.use('/public', express.static(path.join(__dirname, 'src/public')));
// Exponer archivos de análisis de logs para el dashboard
app.use('/logs', express.static(path.join(__dirname, 'logs')));

// Ruta prueba
app.get('/', (req, res) => {
    res.send('Servidor trabajando');
})

// Conexion a la base de datos
if (process.env.NODE_ENV !== 'test') {
    connect()
        .then(() => {
            const logger = child({ component: 'mongoose' });
            logger.info('mongo_connected');
        })
        .catch((e) => {
            const logger = child({ component: 'mongoose' });
            logger.error('mongo_connection_error', { context: { message: e.message, code: e.code, name: e.name, stack: e.stack } });
            try { console.error('mongo_connection_error', e); } catch {}
            const exitOnFail = String(process.env.MONGO_EXIT_ON_FAIL || 'true').toLowerCase() === 'true';
            if (exitOnFail) {
                process.exit(1);
            }
        });
}

// Crear servidor HTTP
const server = http.createServer(app);

// Configurar Socket.io
const io = new Server(server, {
    cors: {
        origin: "*", // En producción cambiar esto por la URL del Dominio
        methods: ["GET", "POST"]
    }
});

// Lógica de conexión de Sockets
io.on('connection', (socket) => {
    const logger = child({ component: 'socket', socketId: socket.id });
    logger.info('socket_connected');

    // 1. El usuario se une a una sala según su rol o su propio ID
    socket.on('entrar_sala', (id) => {
        if (id === 'admin' || id === 'repartidor' || id === 'editor') {
            socket.join('sala_pedidos'); // Sala exclusiva para staff
            logger.info('socket_join_room', { context: { room: 'sala_pedidos', rol: id } });
        } else if (id) {
            // El cliente se une a su propia sala para recibir notificaciones push
            socket.join(String(id));
            logger.info('socket_join_room', { context: { room: String(id), userId: id } });
        }
    });

    socket.on('disconnect', () => {
        logger.info('socket_disconnected');
    });
});


// --- IMPORTANTE: Hacer 'io' accesible en los controladores ---
app.set('socketio', io);

// Rutas
const sessionSecret = process.env.SUPERADMIN_SESSION_SECRET || process.env.JWT_SECRET || 'dev_superadmin_secret';
app.use('/superadmin', (req, res, next) => {
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "img-src 'self' data: https:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline'",
        "connect-src 'self'",
    ].join('; '));
    next();
});
app.use('/superadmin', session({
    name: 'sfjpii_superadmin',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/superadmin',
        maxAge: 8 * 60 * 60 * 1000
    }
}));
app.use('/superadmin', superAdminRoutes);

app.use('/api/productos', productRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/pedidos',pedidoRoutes);
app.use('/api/ubicaciones',ubicacionesRoutes);
app.use('/api/carrito', carritoRoutes);
app.use('/api/user', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
}, userRoutes);

// Ruta de diagnóstico para simular latencia
app.get('/api/debug/delay', async (req, res) => {
    const ms = Number(req.query.ms) || 600;
    await new Promise(resolve => setTimeout(resolve, ms));
    res.json({ ok: true, delayMs: ms });
});

// Ruta de diagnóstico para provocar un error 500
app.get('/api/debug/error', (req, res) => {
    throw new Error('debug_error_triggered');
});

// Manejo global de errores
app.use(errorHandler);

// Solo iniciar si no estamos en modo test
if (process.env.NODE_ENV !== 'test') {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        const logger = child();
        logger.info('server_started', { context: { url: `http://localhost:${PORT}` } });
    })
}

module.exports = { app, server };

// Captura global de errores no manejados
process.on('uncaughtException', (err) => {
    const logger = child({ component: 'process' });
    logger.error('uncaught_exception', { context: { stack: err.stack, message: err.message } });
});
process.on('unhandledRejection', (reason) => {
    const logger = child({ component: 'process' });
    logger.error('unhandled_rejection', { context: { reason } });
});
