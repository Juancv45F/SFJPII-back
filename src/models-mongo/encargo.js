const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  productoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
  nombre: { type: String, required: true },
  imagen: String,
  cantidad: { type: Number, required: true, min: 1, max: 999, validate: Number.isInteger },
  precio_unitario: { type: Number, required: true, min: 0 }
}, { _id: false });

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  solicitudId: { type: String, required: true },
  items: { type: [itemSchema], validate: v => v.length > 0 },
  total_estimado: { type: Number, required: true, min: 0 },
  estado: { type: String, enum: ['pendiente', 'disponible', 'en_camino', 'entregado', 'cancelado'], default: 'pendiente' },
  tipo_entrega: { type: String, enum: ['recoger', 'domicilio'], required: true },
  ubicacion: {
    ubicacionId: mongoose.Schema.Types.ObjectId,
    calle: String, numero: String, codigo_postal: String, descripcion: String, alias: String
  },
  motivo_cancelacion: { type: String, maxlength: 500 },
  disponibleAt: Date,
  historial: [{
    estado: String,
    fecha: { type: Date, default: Date.now },
    usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }]
}, { timestamps: true, collection: 'encargos' });

schema.index({ userId: 1, solicitudId: 1 }, { unique: true });
schema.index({ userId: 1, createdAt: -1 });
schema.index({ estado: 1, createdAt: -1 });

module.exports = mongoose.model('Encargo', schema);
