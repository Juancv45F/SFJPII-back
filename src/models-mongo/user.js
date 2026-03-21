const mongoose = require('mongoose');

const UbicacionSchema = new mongoose.Schema({
  calle: { type: String, required: true },
  numero: { type: String, required: true },
  codigo_postal: { type: String, required: true },
  descripcion: { type: String },
  alias: { type: String, default: 'Casa' }
});

const CarritoItemSchema = new mongoose.Schema({
  productoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Producto', required: true },
  nombre: { type: String },
  precio_unitario: { type: Number },
  cantidad: { type: Number, required: true, min: 1 },
  imagen: { type: String }
}, { _id: false });

const schema = new mongoose.Schema({
  nombre: { type: String, required: true },
  apellido: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  foto_perfil: { type: String },
  verificationCode: { type: String },
  verificationCodeSentAt: { type: Date },
  isVerified: { type: Boolean, default: false },
  role: { type: String, default: 'cliente' },
  mfa: {
    enabled: { type: Boolean, default: false },
    channel: { type: String, default: 'email' },
    otpHash: { type: String },
    otpExpiresAt: { type: Date },
    otpAttempts: { type: Number, default: 0 },
    otpSentAt: { type: Date }
  },
  preferences: {
    theme: { type: String, default: 'light' },
    language: { type: String, default: 'es' }
  },
  refreshTokens: [{
    sessionId: { type: String },
    tokenHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedByTokenHash: { type: String },
    userAgent: { type: String },
    ip: { type: String }
  }],
  ubicaciones: [UbicacionSchema],
  carrito: {
    items: [CarritoItemSchema]
  }
}, { timestamps: true });

module.exports = mongoose.model('User', schema);
