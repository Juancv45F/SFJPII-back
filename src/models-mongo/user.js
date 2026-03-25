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
  role: { type: String, enum: ['admin', 'editor', 'cliente'], default: 'cliente' },
  
  webauthn: {
    currentChallenge: { type: String },
    credentials: [{
      credentialID: { type: String, required: true },
      credentialPublicKey: { type: String, required: true },
      counter: { type: Number, default: 0 },
      transports: [{ type: String }]
    }]
  },

  // Recuperación de Contraseña
  recovery: {
    tokenHash: { type: String },
    tokenExpiresAt: { type: Date },
    tokenAttempts: { type: Number, default: 0 },
    lastRequestedAt: { type: Date },
    questions: [{
      questionId: { type: String }, // e.g., 'mascota', 'ciudad'
      answerHash: { type: String },
      attempts: { type: Number, default: 0 }
    }],
    questionsBlockedUntil: { type: Date }
  },

  mfa: {
    enabled: { type: Boolean, default: false },
    channel: { type: String, default: 'email' },
    method: { type: String, enum: ['email', 'totp'], default: 'email' },
    otpHash: { type: String },
    otpExpiresAt: { type: Date },
    otpAttempts: { type: Number, default: 0 },
    otpSentAt: { type: Date },
    totpSecret: { type: String },
    totpTempSecret: { type: String },
    totpVerifiedAt: { type: Date }
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
  pushTokens: [{
    token: { type: String, required: true },
    platform: { type: String, enum: ['android','ios','web','unknown'], default: 'android' },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    revokedAt: { type: Date }
  }],
  ubicaciones: [UbicacionSchema],
  carrito: {
    items: [CarritoItemSchema]
  }
}, { timestamps: true });

module.exports = mongoose.model('User', schema);
