const Producto = require('../models-mongo/product');

function normalizarUnidades(value) {
  const unidades = Number(value);
  return Number.isInteger(unidades) && unidades >= 2 ? unidades : null;
}

function idProductoBase(producto) {
  if (!producto?.producto_base) return null;
  return String(producto.producto_base?._id || producto.producto_base);
}

async function resolverPromocion(producto, { session } = {}) {
  const baseId = idProductoBase(producto);
  if (!baseId) {
    return { productoInventario: producto, unidades: 1, esPromocion: false };
  }

  const unidades = normalizarUnidades(producto.unidades_por_venta);
  if (!unidades) throw new Error(`La promoción ${producto.nombre} tiene una configuración inválida.`);

  let query = Producto.findById(baseId);
  if (session) query = query.session(session);
  const productoInventario = await query.exec();
  if (!productoInventario) throw new Error(`El producto base de la promoción ${producto.nombre} ya no existe.`);
  if (productoInventario.solo_encargo) {
    throw new Error(`El producto base de la promoción ${producto.nombre} no puede ser exclusivo por encargo.`);
  }

  return { productoInventario, unidades, esPromocion: true };
}

async function sincronizarPromociones(baseId, stockBase, { session, io } = {}) {
  let query = Producto.find({ producto_base: baseId });
  if (session) query = query.session(session);
  const promociones = await query.exec();

  const actualizadas = [];
  for (const promocion of promociones) {
    const unidades = normalizarUnidades(promocion.unidades_por_venta);
    if (!unidades) continue;
    const stock = Math.floor(Number(stockBase || 0) / unidades);
    if (Number(promocion.stock) !== stock) {
      promocion.stock = stock;
      if (session) await promocion.save({ session });
      else await promocion.save();
    }
    const evento = { productoId: String(promocion._id), nuevoStock: stock };
    actualizadas.push(evento);
    io?.emit('stock_actualizado', evento);
  }

  return actualizadas;
}

module.exports = {
  idProductoBase,
  normalizarUnidades,
  resolverPromocion,
  sincronizarPromociones
};
