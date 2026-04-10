const mongoose = require('mongoose');

const DetallePedidoSchema = new mongoose.Schema({
  productoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
  nombre: { type: String },
  imagen: { type: String },
  precio_unitario: { type: Number, required: true },
  cantidad: { type: Number, required: true, min: 1 },
  subtotal: { type: Number, required: true },
  descuento: { type: Number, default: 0 }
}, { _id: false });

module.exports = DetallePedidoSchema;
