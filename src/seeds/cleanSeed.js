require('dotenv').config();
const { sequelize } = require('../config/database');
const { User, Ubicacion, Pedido, DetallePedido } = require('../models');

const cleanDatabase = async () => {
    try {
        await sequelize.authenticate();
        console.log('>>> Conexión establecida para limpieza.');

        console.log('>>> Iniciando limpieza de datos de prueba...');

        // 1. Eliminar DetallePedido (Tabla intermedia)
        await DetallePedido.destroy({ where: {}, truncate: false });
        console.log('✅ DetallePedido eliminado');

        // 2. Eliminar Pedidos
        await Pedido.destroy({ where: {}, truncate: false });
        console.log('✅ Pedidos eliminados');

        // 3. Eliminar Ubicaciones
        await Ubicacion.destroy({ where: {}, truncate: false });
        console.log('✅ Ubicaciones eliminadas');

        // 4. Eliminar Usuarios
        await User.destroy({ where: {}, truncate: false });
        console.log('✅ Usuarios eliminados');

        console.log('>>> Limpieza completada exitosamente.');
        console.log('>>> Se han conservado: ROLES, CATEGORÍAS y PRODUCTOS.');
        
    } catch (error) {
        console.error('❌ Error al limpiar la base de datos:', error);
    } finally {
        await sequelize.close();
        process.exit();
    }
};

cleanDatabase();
