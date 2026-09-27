const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  titulo: String, mensaje: String,
  tipo: { type: String, enum: ['pedido', 'encargo'], required: true },
  referenciaId: { type: mongoose.Schema.Types.ObjectId, required: true },
  estado: String, leida: { type: Boolean, default: false }
}, { timestamps: true });
schema.index({ userId: 1, createdAt: -1 });
const Notification = mongoose.model('Notification', schema);

async function notify(req, data) {
  // Persistir antes de emitir permite recuperar mensajes tras una desconexión.
  try {
    const notification = await Notification.create(data);
    req.app.get('socketio')?.to(String(data.userId)).emit('notificacion_cliente', notification);
    return notification;
  } catch (error) {
    // El pedido ya está guardado: un fallo de avisos no debe provocar que el cliente
    // vuelva a comprar creyendo que la operación principal falló.
    const logger = req.logger || require('../utils/logger').child({ component: 'notifications' });
    logger.error('notification_failed', { context: { referenciaId: String(data.referenciaId), message: error.message } });
    return null;
  }
}
module.exports = { Notification, notify };
