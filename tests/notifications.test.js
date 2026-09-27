const http = require('http');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
// Cliente mínimo de protocolo para probar el servidor real sin dependencias entre repositorios.
const { EventEmitter } = require('node:events');
function client(url, options) {
  const events = new EventEmitter();
  let ws;
  const s = { id: '', on: (...args) => events.on(...args), once: (...args) => events.once(...args),
    emit: (event, data) => ws.send('42' + JSON.stringify([event, data])),
    disconnect: () => ws?.close(),
    connect: () => {
      ws = new WebSocket(url.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket');
      ws.onmessage = event => {
        const packet = String(event.data);
        if (packet[0] === '0') ws.send('40' + JSON.stringify(options.auth || {}));
        else if (packet === '2') ws.send('3');
        else if (packet.startsWith('40')) { s.id = JSON.parse(packet.slice(2)).sid; events.emit('connect'); }
        else if (packet.startsWith('44')) events.emit('connect_error', JSON.parse(packet.slice(2)));
        else if (packet.startsWith('42')) { const [name, data] = JSON.parse(packet.slice(2)); events.emit(name, data); }
      };
    }
  };
  s.connect(); return s;
}
const User = require('../src/models-mongo/user');
const { Notification, notify } = require('../src/services/notifications');
const { configureSockets } = require('../src/services/socketAuth');
const router = require('../src/routes/notificationRoutes');
const uid = '111111111111111111111111', other = '222222222222222222222222';
const nid = '333333333333333333333333';
const query = value => { const q = { exec: jest.fn().mockResolvedValue(value) }; for (const k of ['select','sort','limit','lean']) q[k] = () => q; return q; };
let app, server, io, sockets;
beforeEach(async () => {
  process.env.JWT_SECRET = 'socket-test'; sockets = [];
  jest.spyOn(User, 'findById').mockImplementation(id => query({ _id: id, role: 'cliente' }));
  app = express(); app.use(express.json()); app.use('/notifications', router);
  server = http.createServer(app); io = new Server(server); configureSockets(io); app.set('socketio', io);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
});
afterEach(async () => { sockets.forEach(s => s.disconnect()); await new Promise(r => io.close(r)); jest.restoreAllMocks(); });
const token = id => jwt.sign({ uid: id }, process.env.JWT_SECRET, { expiresIn: '1h' });
async function connect(id) { const s = client(`http://127.0.0.1:${server.address().port}`, { auth: id ? { token: token(id) } : {}, transports: ['websocket'], forceNew: true }); sockets.push(s); await new Promise((r,j) => { s.once('connect',r); s.once('connect_error',j); }); return s; }
test('las salas privadas se asignan al propietario y no aceptan suplantación', async () => {
  const a = await connect(uid), b = await connect(other), guest = await connect();
  a.emit('entrar_sala', other); guest.emit('entrar_sala', 'admin');
  await new Promise(r => setTimeout(r, 30));
  expect(io.sockets.sockets.get(a.id).rooms.has(other)).toBe(false);
  expect(io.sockets.sockets.get(guest.id).rooms.has('sala_pedidos')).toBe(false);
  const receive = new Promise(r => a.once('notificacion_cliente', r));
  const unwanted = jest.fn(); b.on('notificacion_cliente', unwanted);
  jest.spyOn(Notification, 'create').mockImplementation(async n => ({ _id: nid, ...n }));
  await notify({ app }, { userId: uid, titulo: 'Ya llegó', tipo: 'encargo', referenciaId: nid });
  expect((await receive).titulo).toBe('Ya llegó');
  expect(unwanted).not.toHaveBeenCalled();
});
test('recupera historial por propietario y marca lectura sin acceder a otros usuarios', async () => {
  jest.spyOn(Notification, 'find').mockImplementation(filter => query(filter.leida ? [] : [{ _id: nid, userId: uid, leida: false, createdAt: new Date() }]));
  const res = await request(app).get('/notifications').set('x-token', token(uid));
  expect(res.status).toBe(200); expect(res.body.data).toHaveLength(1);
  expect(Notification.find).toHaveBeenCalledWith({ userId: uid, leida: false });
  jest.spyOn(Notification, 'findOneAndUpdate').mockImplementation(() => query(null));
  expect((await request(app).patch(`/notifications/${nid}/leida`).set('x-token', token(other))).status).toBe(404);
  expect(Notification.findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: nid, userId: other });
  expect((await request(app).get('/notifications')).status).toBe(401);
});
test('recupera su sala al reconectar y rechaza tokens inválidos', async () => {
  const a = await connect(uid); a.disconnect();
  const reconnected = new Promise(r => a.once('connect', r)); a.connect(); await reconnected;
  expect(io.sockets.sockets.get(a.id).rooms.has(uid)).toBe(true);
  const invalid = client(`http://127.0.0.1:${server.address().port}`, { auth: { token: 'invalid' }, forceNew: true }); sockets.push(invalid);
  const error = await new Promise(r => invalid.once('connect_error', r));
  expect(error.message).toBe('Sesión no válida');
});

test('una falla del aviso no provoca repetir una compra ya guardada', async () => {
  jest.spyOn(Notification, 'create').mockRejectedValue(new Error('database unavailable'));
  const logger = { error: jest.fn() };
  expect(await notify({ app, logger }, { userId: uid, tipo: 'pedido', referenciaId: nid })).toBeNull();
  expect(logger.error).toHaveBeenCalledWith('notification_failed', expect.anything());
});
