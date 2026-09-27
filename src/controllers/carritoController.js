const mongoose = require('mongoose');
const User = require('../models-mongo/user');
const Producto = require('../models-mongo/product');

async function getCarrito(req, res) {
  try {
    const userId = req.uid;
    const user = await User.findById(userId).exec();
    if (!user) {
      return res.status(404).json({ ok: false, message: 'Usuario no encontrado' });
    }
    const items = user?.carrito?.items || [];
    if (items.length === 0) {
      return res.json({ ok: true, data: [] });
    }
    const ids = items.map(i => String(i.productoId));
    const productos = await Producto.find({ _id: { $in: ids } }).exec();
    const productosMap = new Map(productos.map(p => [String(p._id), p]));
    const data = items
      .map(it => {
        const p = productosMap.get(String(it.productoId));
        if (!p) return null;
        return {
          id: String(p._id),
          nombre: p.nombre,
          precio: p.precio,
          descuento: p.descuento || 0,
          stock: p.stock,
          solo_encargo: !!p.solo_encargo,
          imagen: p.imagen,
          cantidad: it.cantidad,
          modo: it.modo || 'compra'
        };
      })
      .filter(Boolean);
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Error al obtener carrito' });
  }
}

async function syncCarrito(req, res) {
  try {
    const userId = req.uid;
    const { items } = req.body || {};
    if (!Array.isArray(items)) {
      return res.status(400).json({ ok: false, message: 'Items inválidos' });
    }

    if (items.length > 100 || items.some(x => !x || !mongoose.isValidObjectId(String(x.id || x.productoId || '')) ||
      !Number.isInteger(Number(x.cantidad)) || Number(x.cantidad) < 1 || Number(x.cantidad) > 999 ||
      !['compra', 'encargo'].includes(x.modo || 'compra'))) {
      return res.status(400).json({ ok: false, message: 'Medicamento, cantidad o modo inválido' });
    }
    const parsed = items
      .map(x => ({
        id: String(x.id || x.productoId || ''),
        cantidad: Number(x.cantidad || 0),
        modo: x.modo || 'compra'
      }))
      .filter(x => mongoose.isValidObjectId(x.id) && x.cantidad > 0);

    const ids = parsed.map(x => x.id);
    if (new Set(ids).size !== ids.length) return res.status(400).json({ ok: false, message: 'Medicamentos duplicados' });
    const productos = await Producto.find({ _id: { $in: ids } }).exec();
    const productosMap = new Map(productos.map(p => [String(p._id), p]));

    const conflicts = parsed.flatMap(it => {
      const p = productosMap.get(it.id);
      const reason = !p ? 'eliminado' : it.modo === 'encargo' && Number(p.stock) !== 0 ? 'disponible' : it.modo === 'compra' && (p.solo_encargo || Number(p.stock) === 0) ? 'agotado' : it.modo === 'compra' && it.cantidad > p.stock ? 'insuficiente' : null;
      return reason ? [{ id: it.id, nombre: p?.nombre, motivo: reason, stock: p?.stock || 0, solo_encargo: !!p?.solo_encargo, puedeEncargar: !!p && Number(p.stock) === 0 }] : [];
    });
    if (conflicts.length) return res.status(409).json({ ok: false, message: 'El inventario cambió. Revisa los productos pendientes en tu carrito.', conflicts });
    const finalItems = [];
    for (const it of parsed) {
      const p = productosMap.get(it.id);
      if (!p) continue;
      if (it.modo === 'encargo' && Number(p.stock) !== 0) return res.status(409).json({ ok: false, message: 'Solo puedes encargar medicamentos sin stock. Mueve los disponibles a Comprar ahora.' });
      if (it.modo === 'compra' && p.solo_encargo) return res.status(409).json({ ok: false, message: 'Este medicamento es exclusivo por encargo.' });
      const cantidad = it.modo === 'encargo' ? it.cantidad : Math.min(it.cantidad, Math.max(0, p.stock));
      if (cantidad <= 0) continue;
      finalItems.push({
        productoId: p._id,
        modo: it.modo,
        nombre: p.nombre,
        precio_unitario: p.precio,
        cantidad,
        imagen: p.imagen
      });
    }

    const user = await User.findById(userId).exec();
    if (!user) {
      return res.status(404).json({ ok: false, message: 'Usuario no encontrado' });
    }
    user.carrito = { items: finalItems };
    await user.save();

    const data = finalItems.map(it => {
      const p = productosMap.get(String(it.productoId));
      return {
        id: String(it.productoId),
        nombre: it.nombre,
        precio: it.precio_unitario,
        descuento: p?.descuento || 0,
        stock: p?.stock ?? 0,
        solo_encargo: !!p?.solo_encargo,
        imagen: it.imagen,
        cantidad: it.cantidad,
        modo: it.modo
      };
    });

    return res.json({ ok: true, message: 'Carrito sincronizado', data });
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Error al sincronizar carrito' });
  }
}

async function removeItem(req, res) {
  try {
    const userId = req.uid;
    const { id } = req.params;
    if (!mongoose.isValidObjectId(String(id))) {
      return res.status(400).json({ ok: false, message: 'ID inválido' });
    }
    const user = await User.findById(userId).exec();
    if (!user) {
      return res.status(404).json({ ok: false, message: 'Usuario no encontrado' });
    }
    const before = Array.isArray(user?.carrito?.items) ? user.carrito.items.length : 0;
    const items = (user?.carrito?.items || []).filter(it => String(it.productoId) !== String(id));
    user.carrito = { items };
    await user.save();
    return res.json({ ok: true, removed: items.length !== before });
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Error al eliminar item' });
  }
}

async function addItem(req, res) {
  try {
    const userId = req.uid;
    const { id } = req.params;
    const cantidadReq = Number(req.body?.cantidad ?? 1);
    const modo = req.body?.modo || 'compra';
    if (!['compra', 'encargo'].includes(modo)) {
      return res.status(400).json({ ok: false, message: 'Modo inválido' });
    }
    if (!mongoose.isValidObjectId(String(id))) {
      return res.status(400).json({ ok: false, message: 'ID inválido' });
    }
    if (!Number.isInteger(cantidadReq) || cantidadReq <= 0 || cantidadReq > 999) {
      return res.status(400).json({ ok: false, message: 'Cantidad inválida' });
    }
    const [user, producto] = await Promise.all([
      User.findById(userId).exec(),
      Producto.findById(id).exec()
    ]);
    if (!user) {
      return res.status(404).json({ ok: false, message: 'Usuario no encontrado' });
    }
    if (!producto) {
      return res.status(404).json({ ok: false, message: 'Producto no encontrado' });
    }
    if (modo === 'encargo' && Number(producto.stock) !== 0) return res.status(409).json({ ok: false, message: 'Solo puedes encargar medicamentos sin stock.' });
    if (modo === 'compra' && producto.solo_encargo) return res.status(409).json({ ok: false, message: 'Este medicamento es exclusivo por encargo.' });
    const maxStock = modo === 'encargo' ? 999 : Math.min(999, Math.max(0, producto.stock));
    if (maxStock === 0) {
      return res.status(400).json({ ok: false, message: 'Sin stock disponible' });
    }
    const items = Array.isArray(user?.carrito?.items) ? [...user.carrito.items] : [];
    const idx = items.findIndex(it => String(it.productoId) === String(id));
    if (idx >= 0 && (items[idx].modo || 'compra') !== modo) {
      return res.status(409).json({ ok: false, message: 'Mueve el medicamento entre Comprar ahora y Encargos desde el carrito' });
    }
    if (idx >= 0) {
      const nuevaCantidad = Math.min(items[idx].cantidad + cantidadReq, maxStock);
      items[idx] = {
        ...(items[idx].toObject ? items[idx].toObject() : items[idx]),
        modo,
        cantidad: nuevaCantidad,
        nombre: producto.nombre,
        precio_unitario: producto.precio,
        imagen: producto.imagen
      };
    } else {
      items.push({
        productoId: producto._id,
        modo,
        nombre: producto.nombre,
        precio_unitario: producto.precio,
        cantidad: Math.min(cantidadReq, maxStock),
        imagen: producto.imagen
      });
    }
    user.carrito = { items };
    await user.save();
    return res.json({ ok: true, message: 'Item agregado', data: { id: String(producto._id) } });
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Error al agregar item' });
  }
}

module.exports = {
  getCarrito,
  syncCarrito,
  removeItem,
  addItem
};
