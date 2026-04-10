const { sequelize } = require('../src/config/database');
const { Producto } = require('../src/models');
const { Op } = require('sequelize');
const { child } = require('../src/utils/logger');

async function run() {
  const logger = child({ component: 'cleanup' });
  try {
    await sequelize.authenticate();
    logger.info('cleanup_started');
    const where = {
      [Op.or]: [
        { nombre: { [Op.iLike]: 'ProductoDemo%' } },
        { nombre: 'ProductoEditado' }
      ]
    };
    const found = await Producto.findAll({ where, attributes: ['id', 'nombre'] });
    const ids = found.map(p => p.id);
    if (ids.length === 0) {
      logger.info('cleanup_no_products');
      console.log('No se encontraron productos de escenarios para borrar.');
      return;
    }
    const deleted = await Producto.destroy({ where });
    logger.info('cleanup_deleted', { context: { count: deleted, ids } });
    console.log(`Eliminados ${deleted} productos de escenarios:`, ids);
  } catch (err) {
    const loggerErr = child({ component: 'cleanup' });
    loggerErr.error('cleanup_error', { context: { message: err.message, stack: err.stack } });
    console.error('Error en limpieza:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close().catch(() => {});
  }
}

run();
