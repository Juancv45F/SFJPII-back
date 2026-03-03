require('dotenv').config(); // Importante para leer el .env aquí
const { Sequelize } = require('sequelize');
const { child } = require('../utils/logger');

const sequelize = new Sequelize(
    process.env.DB_NAME,     // Nombre de la base 
    process.env.DB_USER,     // Usuario 
    process.env.DB_PASSWORD, // Contraseña
    {
        host: process.env.DB_HOST,
        dialect: 'postgres', // <--- Aquí indicamos que es POSTGRES
        benchmark: true,
        logging: (sql, timingMs) => {
            const logger = child({ component: 'sequelize' });
            if (typeof timingMs === 'number' && timingMs > 500) {
                logger.warn('slow_query', { context: { sql, durationMs: timingMs } });
            } else {
                logger.debug('sql_query', { context: { sql, durationMs: timingMs } });
            }
        }
    }
);

const dbConnection = async () => {
    try {
        await sequelize.authenticate();
        const logger = child({ component: 'sequelize' });
        logger.info('db_connected');
        
        // Sincronizar modelos (crea tablas automáticamente si no existen)
        await sequelize.sync({ alter: true }); 
    } catch (error) {
        const logger = child({ component: 'sequelize' });
        logger.error('db_connection_error', { context: { message: error.message, stack: error.stack } });
        throw new Error('Error de conexión a BD');
    }
};

module.exports = {
    sequelize,
    dbConnection
};
