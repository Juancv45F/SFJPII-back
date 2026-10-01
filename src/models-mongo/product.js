const mongoose = require('mongoose');

const CategoriaEmbeddedSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, required: true },
  nombre: { type: String, required: true },
  descripcion: { type: String },
  activa: { type: Boolean, default: true }
}, { _id: false });

const schema = new mongoose.Schema({
  nombre: { type: String, required: true, index: true, unique: true },
  descripcion: { type: String },
  precio: { type: Number, required: true },
  descuento: { type: Number, default: 0, min: 0, max: 100 },
  stock: { type: Number, default: 0, min: 0 },
  producto_base: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Producto',
    default: null,
    index: true
  },
  unidades_por_venta: { type: Number, default: 1, min: 1 },
  solo_encargo: { type: Boolean, default: false, index: true },
  imagen: { type: String },
  requiere_receta: { type: Boolean, default: false },
  categoria: CategoriaEmbeddedSchema
}, { timestamps: true });

module.exports = mongoose.model('Producto', schema);
