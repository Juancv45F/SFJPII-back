const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const User = require('../src/models-mongo/user');
const router = require('../src/routes/adminChatRoutes');
const app = express(); app.use(express.json()); app.use('/admin', router);
let sequence = 0;
function send(role = 'admin', mensaje = ' ventas ') {
  jest.spyOn(User, 'findById').mockReturnValue({ select: () => ({ exec: async () => ({ role }) }) });
  return request(app).post('/admin/chat').set('x-token', jwt.sign({ uid: String(++sequence) }, process.env.JWT_SECRET)).send({ mensaje });
}
beforeEach(() => {
  process.env.JWT_SECRET = 'test-only';
  process.env.SFJPII_AI_SERVICE_KEY = 'private-test-key';
  process.env.SFJPII_AI_URL = 'http://ai.test';
  jest.spyOn(axios, 'post').mockResolvedValue({ data: { respuesta: 'Ventas del mes', grafica: null } });
});
afterEach(() => jest.restoreAllMocks());
test('rechaza visitantes sin sesión', async () => {
  expect((await request(app).post('/admin/chat').send({ mensaje: 'ventas' })).status).toBe(401);
  expect(axios.post).not.toHaveBeenCalled();
});
test.each(['cliente', 'editor'])('rechaza rol %s', async role => {
  expect((await send(role)).status).toBe(403); expect(axios.post).not.toHaveBeenCalled();
});
test.each(['admin', 'super_admin'])('permite %s y conserva la clave en el servidor', async role => {
  const res = await send(role);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ respuesta: 'Ventas del mes', grafica: null, tools_utilizadas: [] });
  expect(axios.post).toHaveBeenCalledWith('http://ai.test/admin/chat', { mensaje: 'ventas' }, expect.objectContaining({ headers: { 'X-Service-Key': 'private-test-key' }, maxRedirects: 0 }));
  expect(res.headers['cache-control']).toBe('no-store');
});
test.each(['', 'x'.repeat(2001), 123])('valida la consulta', async mensaje => {
  expect((await send('admin', mensaje)).status).toBe(400); expect(axios.post).not.toHaveBeenCalled();
});
test('requiere configuración privada', async () => {
  delete process.env.SFJPII_AI_SERVICE_KEY;
  expect((await send()).status).toBe(503); expect(axios.post).not.toHaveBeenCalled();
});
test('maneja timeout sin revelar errores internos', async () => {
  axios.post.mockRejectedValue({ code: 'ECONNABORTED', message: 'private-test-key' });
  const res = await send(); expect(res.status).toBe(504); expect(JSON.stringify(res.body)).not.toContain('private-test-key');
});
test('rechaza respuestas inválidas del servicio', async () => {
  axios.post.mockResolvedValue({ data: {} }); expect((await send()).status).toBe(502);
});
