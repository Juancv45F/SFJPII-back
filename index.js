require('dotenv').config(); // variables de entorno
const express = require ('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { dbConnection } = require('./src/config/database');
const productRoutes = require('./src/routes/productRoutes');
const authRoutes = require('./src/routes/authRoutes');
const pedidoRoutes = require('./src/routes/pedidosRoutes');
const ubicacionesRoutes = require('./src/routes/ubicacionesRoutes')

const app = express();

// Middlewares
app.use(cors()); // Permitir peticiones externas
app.use(express.json()); // Que entienda json

// Ruta prueba
app.get('/', (req, res) => {
    res.send('Servidor trabajando');
})

// Conexion a la base de datos
dbConnection();

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
    console.log('Usuario conectado:', socket.id);

    // 1. El usuario se une a una sala según su rol (admin o repartidor)
    socket.on('entrar_sala', (rol) => {
        if (rol === 'admin' || rol === 'repartidor') {
            socket.join('sala_pedidos'); // Sala exclusiva para staff
            console.log(`Usuario ${socket.id} unido a sala_pedidos como ${rol}`);
        }
        
    });

    socket.on('disconnect', () => {
        console.log('Usuario desconectado');
    });
});


// --- IMPORTANTE: Hacer 'io' accesible en los controladores ---
app.set('socketio', io);

// Rutas
app.use('/api/productos', productRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/pedidos',pedidoRoutes);
app.use('/api/ubicaciones',ubicacionesRoutes);

// Iniciar servidor en puerto correspondiente
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
})
