const mongoose = require('mongoose');
const DetallePedidoSchema = require('./detallePedido');

const UbicacionSnapshotSchema = new mongoose.Schema({
  calle: { type: String, required: true },
  numero: { type: String, required: true },
  codigo_postal: { type: String, required: true },
  descripcion: { type: String },
  alias: { type: String }
}, { _id: false });

const schema = new mongoose.Schema({
  fecha: { type: Date, default: Date.now },
  total: { type: Number, required: true },
  estado: { type: String, enum: ['pendiente', 'pagado', 'en_camino', 'entregado', 'cancelado'], default: 'pendiente' },
  metodo_pago: { type: String, default: 'efectivo' },
  tipo_entrega: { type: String, enum: ['domicilio', 'recoger'], default: 'domicilio' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ubicacion: UbicacionSnapshotSchema,
  items: [DetallePedidoSchema]
}, { timestamps: true });

module.exports = mongoose.model('Pedido', schema);
