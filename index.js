require('dotenv').config(); // variables de entorno
const express = require ('express');
const cors = require('cors');
const { dbConnection } = require('./src/config/database');
const productRoutes = require('./src/routes/productRoutes');
const authRoutes = require('./src/routes/authRoutes');

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

// Rutas
app.use('/api/productos', productRoutes);
app.use('/api/auth', authRoutes);


// Iniciar servidor en puerto correspondiente
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
})
