require('dotenv').config(); // variables de entorno
const express = require ('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { connect } = require('./src/config/mongoose');
const productRoutes = require('./src/routes/productRoutes');
const authRoutes = require('./src/routes/authRoutes');
const pedidoRoutes = require('./src/routes/pedidosRoutes');
const ubicacionesRoutes = require('./src/routes/ubicacionesRoutes')
const path = require('path');
const { requestLogger, errorHandler } = require('./src/middlewares/logging');
const { child } = require('./src/utils/logger');



const app = express();

// Middlewares
app.use(cors()); // Permitir peticiones externas
app.use(express.json()); // Que entienda json
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

    // 1. El usuario se une a una sala según su rol (admin o repartidor)
    socket.on('entrar_sala', (rol) => {
        if (rol === 'admin' || rol === 'repartidor') {
            socket.join('sala_pedidos'); // Sala exclusiva para staff
            logger.info('socket_join_room', { context: { room: 'sala_pedidos', rol } });
        }
        
    });

    socket.on('disconnect', () => {
        logger.info('socket_disconnected');
    });
});


// --- IMPORTANTE: Hacer 'io' accesible en los controladores ---
app.set('socketio', io);

// Rutas
app.use('/api/productos', productRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/pedidos',pedidoRoutes);
app.use('/api/ubicaciones',ubicacionesRoutes);

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

// Iniciar servidor en puerto correspondiente
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    const logger = child();
    logger.info('server_started', { context: { url: `http://localhost:${PORT}` } });
})

// Captura global de errores no manejados
process.on('uncaughtException', (err) => {
    const logger = child({ component: 'process' });
    logger.error('uncaught_exception', { context: { stack: err.stack, message: err.message } });
});
process.on('unhandledRejection', (reason) => {
    const logger = child({ component: 'process' });
    logger.error('unhandled_rejection', { context: { reason } });
});
