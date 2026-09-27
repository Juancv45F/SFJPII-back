const jwt = require('jsonwebtoken');
const { validateToken } = require('../middlewares/validateToken');
function configureSockets(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    // Visitantes reciben únicamente cambios públicos del catálogo.
    if (!token) return next();
    const req = { header: name => name === 'x-token' ? token : undefined };
    const res = { status: () => res, json: () => next(new Error('Sesión no válida')) };
    validateToken(req, res, () => {
      socket.data.userId = req.uid;
      socket.data.role = req.rol;
      socket.data.exp = jwt.decode(token).exp;
      next();
    });
  });
  io.on('connection', socket => {
    if (socket.data.userId) socket.join(String(socket.data.userId));
    if (['admin', 'editor', 'repartidor', 'super_admin'].includes(socket.data.role)) socket.join('sala_pedidos');
    // Las salas se asignan desde la identidad verificada, nunca desde entrar_sala.
    if (socket.data.exp) {
      const timer = setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.exp * 1000 - Date.now()));
      timer.unref?.();
      socket.on('disconnect', () => clearTimeout(timer));
    }
  });
}
module.exports = { configureSockets };
