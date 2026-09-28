const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const User = require('../src/models-mongo/user');
const router = require('../src/routes/clientChatRoutes');

const app = express();
app.use(express.json());
app.use('/cliente', router);

function send({ role = 'cliente', uid = '507f1f77bcf86cd799439011', body = { mensaje: 'Mis pedidos' } } = {}) {
  jest.spyOn(User, 'findById').mockReturnValue({ select: () => ({ exec: async () => ({ role }) }) });
  const token = jwt.sign({ uid }, process.env.JWT_SECRET);
  return request(app).post('/cliente/chat').set('x-token', token).send(body);
}

beforeEach(() => {
  process.env.JWT_SECRET = 'test-only';
  process.env.SFJPII_AI_SERVICE_KEY = 'private-test-key';
  process.env.SFJPII_AI_URL = 'http://ai.test';
  jest.spyOn(axios, 'post').mockResolvedValue({
    data: { respuesta: 'Tienes un pedido pendiente', tools_utilizadas: ['consultar_mis_pedidos'], conversation_id: 'chat-1' }
  });
});

afterEach(() => jest.restoreAllMocks());

test('requiere sesión y rol cliente', async () => {
  expect((await request(app).post('/cliente/chat').send({ mensaje: 'Mis pedidos' })).status).toBe(401);
  expect((await send({ role: 'admin' })).status).toBe(403);
  expect(axios.post).not.toHaveBeenCalled();
});

test('inyecta exclusivamente el usuario autenticado', async () => {
  const uid = '507f1f77bcf86cd799439011';
  const response = await send({ uid, body: { mensaje: ' Mis pedidos ', user_id: 'otro', conversation_id: 'chat-1' } });
  expect(response.status).toBe(200);
  expect(axios.post).toHaveBeenCalledWith('http://ai.test/cliente/chat', {
    mensaje: 'Mis pedidos', conversation_id: 'chat-1'
  }, expect.objectContaining({
    headers: { 'X-Service-Key': 'private-test-key', 'X-User-Id': uid },
    maxRedirects: 0
  }));
  expect(JSON.stringify(axios.post.mock.calls[0])).not.toContain('otro');
});

test.each(['', 'x'.repeat(2001), 123])('valida el mensaje %#', async mensaje => {
  expect((await send({ body: { mensaje } })).status).toBe(400);
  expect(axios.post).not.toHaveBeenCalled();
});

test('valida conversation_id', async () => {
  expect((await send({ body: { mensaje: 'Hola', conversation_id: '../otro' } })).status).toBe(400);
  expect(axios.post).not.toHaveBeenCalled();
});

test('no revela el detalle interno de errores del servicio', async () => {
  axios.post.mockRejectedValue({ response: { status: 422, data: { detail: 'dato privado' } } });
  const response = await send();
  expect(response.status).toBe(422);
  expect(response.text).not.toContain('dato privado');
});
