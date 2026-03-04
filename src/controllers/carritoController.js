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
          imagen: p.imagen,
          cantidad: it.cantidad
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

    const parsed = items
      .map(x => ({
        id: String(x.id || x.productoId || ''),
        cantidad: Number(x.cantidad || 0)
      }))
      .filter(x => mongoose.isValidObjectId(x.id) && x.cantidad > 0);

    const ids = parsed.map(x => x.id);
    const productos = await Producto.find({ _id: { $in: ids } }).exec();
    const productosMap = new Map(productos.map(p => [String(p._id), p]));

    const finalItems = [];
    for (const it of parsed) {
      const p = productosMap.get(it.id);
      if (!p) continue;
      const cantidad = Math.min(it.cantidad, Math.max(0, p.stock));
      if (cantidad <= 0) continue;
      finalItems.push({
        productoId: p._id,
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
        imagen: it.imagen,
        cantidad: it.cantidad
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
    if (!mongoose.isValidObjectId(String(id))) {
      return res.status(400).json({ ok: false, message: 'ID inválido' });
    }
    if (!Number.isFinite(cantidadReq) || cantidadReq <= 0) {
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
    const maxStock = Math.max(0, producto.stock);
    if (maxStock === 0) {
      return res.status(400).json({ ok: false, message: 'Sin stock disponible' });
    }
    const items = Array.isArray(user?.carrito?.items) ? [...user.carrito.items] : [];
    const idx = items.findIndex(it => String(it.productoId) === String(id));
    if (idx >= 0) {
      const nuevaCantidad = Math.min(items[idx].cantidad + cantidadReq, maxStock);
      items[idx] = {
        ...items[idx],
        cantidad: nuevaCantidad,
        nombre: producto.nombre,
        precio_unitario: producto.precio,
        imagen: producto.imagen
      };
    } else {
      items.push({
        productoId: producto._id,
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
