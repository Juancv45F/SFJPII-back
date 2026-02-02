require('dotenv').config(); // Importante para leer el .env aquí
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
    process.env.DB_NAME,     // Nombre de la base (farmacia_db)
    process.env.DB_USER,     // Usuario (postgres)
    process.env.DB_PASSWORD, // Contraseña
    {
        host: process.env.DB_HOST,
        dialect: 'postgres', // <--- Aquí indicamos que es POSTGRES
        logging: false       // Para no llenar la consola de SQL
    }
);

const dbConnection = async () => {
    try {
        await sequelize.authenticate();
        console.log('Base de Datos POSTGRESQL conectada exitosamente');
        
        // Sincronizar modelos (crea tablas automáticamente si no existen)
        await sequelize.sync(); 
    } catch (error) {
        console.error('Error al conectar a Postgres:', error);
        throw new Error('Error de conexión a BD');
    }
};

module.exports = {
    sequelize,
    dbConnection
};