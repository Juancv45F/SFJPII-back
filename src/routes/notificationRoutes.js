const router = require('express').Router();
const mongoose = require('mongoose');
const { validateToken } = require('../middlewares/validateToken');
const { Notification } = require('../services/notifications');
router.use(validateToken);
router.get('/', async (req, res) => {
  try {
    // Todas las no leídas y las últimas 100 leídas, sin perder pendientes antiguos.
    const [unread, read] = await Promise.all([
      Notification.find({ userId: req.uid, leida: false }).sort({ createdAt: -1 }).lean().exec(),
      Notification.find({ userId: req.uid, leida: true }).sort({ createdAt: -1 }).limit(100).lean().exec()
    ]);
    res.json({ ok: true, data: [...unread, ...read].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
  } catch { res.status(500).json({ message: 'No se pudieron cargar las notificaciones' }); }
});
router.patch('/:id/leida', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID inválido' });
  try {
    const data = await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.uid }, { $set: { leida: true } }, { new: true }).lean().exec();
    if (!data) return res.status(404).json({ message: 'Notificación no encontrada' });
    req.app.get('socketio')?.to(String(req.uid)).emit('notificacion_cliente', data);
    res.json({ ok: true, data });
  } catch { res.status(500).json({ message: 'No se pudo marcar la notificación' }); }
});

router.delete('/', async (req, res) => {
  try {
    const result = await Notification.deleteMany({ userId: req.uid }).exec();
    req.app.get('socketio')?.to(String(req.uid)).emit('notificaciones_eliminadas', {
      userId: String(req.uid)
    });
    res.json({ ok: true, eliminadas: result.deletedCount || 0 });
  } catch {
    res.status(500).json({ message: 'No se pudieron eliminar las notificaciones' });
  }
});

router.delete('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID inválido' });
  try {
    const data = await Notification.findOneAndDelete({ _id: req.params.id, userId: req.uid }).exec();
    if (!data) return res.status(404).json({ message: 'Notificación no encontrada' });
    req.app.get('socketio')?.to(String(req.uid)).emit('notificacion_eliminada', {
      _id: String(req.params.id),
      userId: String(req.uid)
    });
    res.status(204).send();
  } catch {
    res.status(500).json({ message: 'No se pudo eliminar la notificación' });
  }
});
module.exports = router;
