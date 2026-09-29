jest.mock('../src/services/notifications', () => ({ notify: jest.fn().mockResolvedValue({}) }));
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const User = require('../src/models-mongo/user');
const Producto = require('../src/models-mongo/product');
const Encargo = require('../src/models-mongo/encargo');
const router = require('../src/routes/encargosRoutes');
const carritoRouter = require('../src/routes/carritoRoutes');

const uid = '111111111111111111111111';
const pid = '222222222222222222222222';
const eid = '333333333333333333333333';
const aid = '444444444444444444444444';
const query = value => {
  const q = { exec: jest.fn().mockResolvedValue(value) };
  for (const method of ['select', 'sort', 'populate']) q[method] = jest.fn(() => q);
  return q;
};
let user;
let app;
const auth = (method, path) => request(app)[method](path).set('x-token', jwt.sign({ uid }, process.env.JWT_SECRET));
const payload = () => ({ productos: [{ id: pid, cantidad: 2 }], tipo_entrega: 'recoger', solicitudId: '3e6a0a56-a2a8-4d55-9d98-a34fbc8da090' });
const existing = (estado = 'pendiente', tipo_entrega = 'recoger', createdAt = '2026-09-28T18:00:00.000Z') => ({
  _id: eid, userId: uid, estado, tipo_entrega, createdAt
});

beforeEach(() => {
  process.env.JWT_SECRET = 'encargos-test-secret';
  app = express(); app.use(express.json()); app.use('/encargos', router); app.use('/carrito', carritoRouter);
  app.set('clock', () => new Date('2026-09-28T18:00:00.000Z'));
  user = { _id: uid, role: 'cliente', ubicaciones: { id: jest.fn(() => null) }, carrito: { items: [] }, save: jest.fn().mockResolvedValue() };
  jest.spyOn(User, 'findById').mockImplementation(() => query(user));
  jest.spyOn(Producto, 'find').mockImplementation(() => query([{ _id: pid, nombre: 'Medicamento', precio: 100, descuento: 10, stock: 0 }]));
  jest.spyOn(Encargo, 'findOne').mockImplementation(() => query(null));
  jest.spyOn(Encargo, 'create').mockImplementation(async data => ({ _id: eid, ...data }));
  jest.spyOn(Encargo, 'find').mockImplementation(() => query([]));
  jest.spyOn(Encargo, 'findOneAndUpdate').mockImplementation(() => query({ ...existing(), estado: 'cancelado' }));
});
afterEach(() => jest.restoreAllMocks());

test('rechaza solicitudes anónimas', async () => {
  expect((await request(app).get('/encargos')).status).toBe(401);
});
test('crea un encargo agotado con precio del servidor y propietario autenticado', async () => {
  const res = await auth('post', '/encargos').send({ ...payload(), userId: aid, total_estimado: 1 });
  expect(res.status).toBe(201);
  expect(res.body.data).toMatchObject({ userId: uid, total_estimado: 180, tipo_entrega: 'recoger' });
  expect(res.body.data.items[0]).toMatchObject({ productoId: pid, cantidad: 2, precio_unitario: 90 });
  expect(res.body.data).toMatchObject({ fecha_estimada_llegada: '2026-09-29' });
  expect(new Date(res.body.data.cancelable_hasta).toISOString()).toBe('2026-09-29T03:00:00.000Z');
});
test('rechaza encargos desde las 10 p. m. pero permite reintentos idempotentes', async () => {
  app.set('clock', () => new Date('2026-09-29T04:00:00.000Z'));
  const blocked = await auth('post', '/encargos').send(payload());
  expect(blocked.status).toBe(409);
  expect(blocked.body.message).toContain('10:00 p. m.');
  expect(Encargo.create).not.toHaveBeenCalled();

  Encargo.findOne.mockImplementation(() => query(existing()));
  const retry = await auth('post', '/encargos').send(payload());
  expect(retry.status).toBe(200);
  expect(retry.body.data._id).toBe(eid);
});
test('un encargo del sábado estima su llegada para el lunes', async () => {
  app.set('clock', () => new Date('2026-09-27T03:30:00.000Z'));
  const res = await auth('post', '/encargos').send(payload());
  expect(res.status).toBe(201);
  expect(res.body.data.fecha_estimada_llegada).toBe('2026-09-28');
});
test('solo usa una dirección guardada del propietario', async () => {
  expect((await auth('post', '/encargos').send({ ...payload(), tipo_entrega: 'domicilio', ubicacionId: aid })).status).toBe(400);
  expect(Encargo.create).not.toHaveBeenCalled();
  user.ubicaciones.id.mockReturnValue({ _id: aid, calle: 'Centro', numero: '10', codigo_postal: '20000', alias: 'Casa' });
  const res = await auth('post', '/encargos').send({ ...payload(), tipo_entrega: 'domicilio', ubicacionId: aid, ubicacion: { calle: 'Falsa' } });
  expect(res.status).toBe(201);
  expect(res.body.data.ubicacion.calle).toBe('Centro');
});
test.each([0, -1, 1.5, 1000, 'x'])('rechaza cantidad inválida %s', async cantidad => {
  const res = await auth('post', '/encargos').send({ ...payload(), productos: [{ id: pid, cantidad }] });
  expect(res.status).toBe(400); expect(Encargo.create).not.toHaveBeenCalled();
});
test('rechaza productos repetidos o inexistentes', async () => {
  expect((await auth('post', '/encargos').send({ ...payload(), productos: [{ id: pid, cantidad: 1 }, { id: pid, cantidad: 2 }] })).status).toBe(400);
  Producto.find.mockImplementation(() => query([]));
  expect((await auth('post', '/encargos').send(payload())).status).toBe(400);
});
test('un reintento devuelve el encargo previo sin crearlo otra vez', async () => {
  Encargo.findOne.mockImplementation(() => query(existing()));
  const res = await auth('post', '/encargos').send(payload());
  expect(res.status).toBe(200); expect(res.body.data._id).toBe(eid); expect(Encargo.create).not.toHaveBeenCalled();
});
test('resuelve una creación duplicada concurrente', async () => {
  Encargo.findOne.mockImplementationOnce(() => query(null)).mockImplementationOnce(() => query(existing()));
  Encargo.create.mockRejectedValue({ code: 11000 });
  expect((await auth('post', '/encargos').send(payload())).body.data._id).toBe(eid);
});
test('clientes solo listan y consultan sus propios encargos', async () => {
  expect((await auth('get', '/encargos')).status).toBe(200);
  expect(Encargo.find).toHaveBeenCalledWith({ userId: uid });
  expect((await auth('get', `/encargos/${eid}`)).status).toBe(404);
  expect(Encargo.findOne).toHaveBeenCalledWith({ _id: eid, userId: uid });
});
test('staff puede listar todos los encargos pero editor no puede crearlos', async () => {
  user.role = 'editor';
  expect((await auth('get', '/encargos')).status).toBe(200);
  expect(Encargo.find).toHaveBeenCalledWith({});
  expect((await auth('post', '/encargos').send(payload())).status).toBe(403);
});
test('un cliente no puede marcar llegada', async () => {
  expect((await auth('patch', `/encargos/${eid}/estado`).send({ estado: 'disponible' })).status).toBe(403);
});
test.each(['', '   ', 'a'.repeat(501)])('cancelar requiere motivo válido', async motivo_cancelacion => {
  expect((await auth('patch', `/encargos/${eid}/estado`).send({ estado: 'cancelado', motivo_cancelacion })).status).toBe(400);
});
test('guarda el motivo y el historial al cancelar', async () => {
  Encargo.findOne.mockImplementation(() => query(existing()));
  const res = await auth('patch', `/encargos/${eid}/estado`).send({ estado: 'cancelado', motivo_cancelacion: '  Ya no lo necesito  ' });
  expect(res.status).toBe(200);
  expect(Encargo.findOneAndUpdate).toHaveBeenCalledWith({ _id: eid, estado: 'pendiente' }, expect.objectContaining({
    $set: { estado: 'cancelado', motivo_cancelacion: 'Ya no lo necesito' },
    $push: { historial: expect.objectContaining({ estado: 'cancelado', usuarioId: uid }) }
  }), { new: true, runValidators: true });
});
test('el cliente no cancela desde las 9 p. m. ni en un día posterior', async () => {
  Encargo.findOne.mockImplementation(() => query(existing()));
  app.set('clock', () => new Date('2026-09-29T03:00:00.000Z'));
  const atCutoff = await auth('patch', `/encargos/${eid}/estado`).send({ estado: 'cancelado', motivo_cancelacion: 'Motivo' });
  expect(atCutoff.status).toBe(409);
  expect(atCutoff.body.message).toContain('9:00 p. m.');
  expect(Encargo.findOneAndUpdate).not.toHaveBeenCalled();

  app.set('clock', () => new Date('2026-09-29T15:00:00.000Z'));
  expect((await auth('patch', `/encargos/${eid}/estado`).send({ estado: 'cancelado', motivo_cancelacion: 'Motivo' })).status).toBe(409);
});
test('el personal conserva la cancelación administrativa después del límite', async () => {
  user.role = 'admin';
  Encargo.findOne.mockImplementation(() => query(existing()));
  app.set('clock', () => new Date('2026-09-29T03:00:00.000Z'));
  expect((await auth('patch', `/encargos/${eid}/estado`).send({ estado: 'cancelado', motivo_cancelacion: 'Proveedor sin existencia' })).status).toBe(200);
});
test.each(['en_camino', 'entregado', 'cancelado'])('no cancela estado %s', async estado => {
  Encargo.findOne.mockImplementation(() => query(existing(estado)));
  expect((await auth('patch', `/encargos/${eid}/estado`).send({ estado: 'cancelado', motivo_cancelacion: 'Motivo' })).status).toBe(409);
});
test('recogida no permite envío a domicilio ni saltar desde pendiente a entregado', async () => {
  user.role = 'admin';
  Encargo.findOne.mockImplementation(() => query(existing('disponible')));
  expect((await auth('patch', `/encargos/${eid}/estado`).send({ estado: 'en_camino' })).status).toBe(409);
  Encargo.findOne.mockImplementation(() => query(existing()));
  expect((await auth('patch', `/encargos/${eid}/estado`).send({ estado: 'entregado' })).status).toBe(409);
});
test.each([['pendiente', 'recoger', 'disponible'], ['disponible', 'recoger', 'entregado'], ['disponible', 'domicilio', 'en_camino'], ['en_camino', 'domicilio', 'entregado']])('staff: %s / %s → %s', async (estado, tipo, next) => {
  user.role = 'admin'; Encargo.findOne.mockImplementation(() => query(existing(estado, tipo)));
  expect((await auth('patch', `/encargos/${eid}/estado`).send({ estado: next })).status).toBe(200);
});
test('detecta una modificación simultánea sin sobrescribirla', async () => {
  Encargo.findOne.mockImplementation(() => query(existing()));
  Encargo.findOneAndUpdate.mockImplementation(() => query(null));
  expect((await auth('patch', `/encargos/${eid}/estado`).send({ estado: 'cancelado', motivo_cancelacion: 'Motivo' })).status).toBe(409);
});
test('rechaza id y estado de filtro inválidos', async () => {
  expect((await auth('get', '/encargos/invalido')).status).toBe(400);
  expect((await auth('get', '/encargos?estado=inventado')).status).toBe(400);
});
test('carrito conserva encargos agotados y limita compras al stock', async () => {
  const res = await auth('post', '/carrito/sync').send({ items: [{ id: pid, cantidad: 3, modo: 'encargo' }] });
  expect(res.status).toBe(200); expect(res.body.data[0]).toMatchObject({ cantidad: 3, modo: 'encargo', stock: 0 });
  const compra = await auth('post', '/carrito/sync').send({ items: [{ id: pid, cantidad: 3, modo: 'compra' }] });
  expect(compra.status).toBe(409);
  expect(compra.body.conflicts[0]).toMatchObject({ motivo: 'agotado', puedeEncargar: true });
});
test('carrito antiguo conserva modo compra', async () => {
  Producto.find.mockImplementation(() => query([{ _id: pid, nombre: 'Medicamento', precio: 100, stock: 2 }]));
  const res = await auth('post', '/carrito/sync').send({ items: [{ id: pid, cantidad: 3 }] });
  expect(res.status).toBe(409); expect(res.body.conflicts[0]).toMatchObject({ motivo: 'insuficiente', stock: 2 });
  expect(user.save).not.toHaveBeenCalled();
});
test('carrito rechaza modo y cantidades inválidos sin guardar', async () => {
  expect((await auth('post', '/carrito/sync').send({ items: [{ id: pid, cantidad: 1, modo: 'otro' }] })).status).toBe(400);
  expect((await auth('post', '/carrito/sync').send({ items: [{ id: pid, cantidad: 1.2 }] })).status).toBe(400);
  expect(user.save).not.toHaveBeenCalled();
});

const productosRouter = require('../src/routes/productRoutes');
describe('Productos exclusivos por encargo', () => {
  beforeEach(() => {
    app.use('/productos', productosRouter);
    jest.spyOn(Producto, 'findById').mockImplementation(() => query({ _id: pid, nombre: 'Especial', stock: 0, solo_encargo: true }));
    jest.spyOn(Producto, 'findOne').mockImplementation(() => query(null));
    jest.spyOn(Producto, 'create').mockImplementation(async p => ({ _id: pid, ...p }));
    jest.spyOn(Producto, 'findByIdAndUpdate').mockImplementation((id, p) => query({ _id: id, ...p }));
    jest.spyOn(Producto, 'findByIdAndDelete').mockImplementation(() => query({ _id: pid }));
  });
  const producto = () => ({ nombre: 'Especial', precio: 3000, stock: 0, solo_encargo: true, categoria: { nombre: 'Especiales' } });
  test('no muestra exclusivos en catálogo normal ni en búsqueda', async () => {
    await auth('get', '/productos'); expect(Producto.find).toHaveBeenLastCalledWith({ solo_encargo: { $ne: true } });
    await auth('get', '/productos/buscar?q=Especial');
    expect(Producto.find).toHaveBeenLastCalledWith(expect.objectContaining({ solo_encargo: { $ne: true } }));
    await auth('get', '/productos?encargos=true');
    expect(Producto.find).toHaveBeenLastCalledWith({ $or: [{ solo_encargo: true }, { stock: 0 }] });
  });
  test('admin crea y edita exclusivo con stock cero numérico', async () => {
    user.role = 'admin';
    const create = await auth('post', '/productos').send(producto());
    expect(create.status).toBe(201); expect(create.body.data.solo_encargo).toBe(true);
    const edit = await auth('put', `/productos/${pid}`).send({ ...producto(), precio: 3100 });
    expect(edit.status).toBe(200); expect(edit.body.data).toMatchObject({ stock: 0, solo_encargo: true, precio: 3100 });
  });
  test('acepta formulario multipart del administrador', async () => {
    user.role = 'admin';
    const res = await auth('post', '/productos').field('nombre', 'Especial').field('precio', '1000').field('stock', '0').field('solo_encargo', 'true').field('categoria', JSON.stringify({ nombre: 'Especiales' }));
    expect(res.status).toBe(201); expect(res.body.data).toMatchObject({ solo_encargo: true, stock: 0 });
  });
  test('rechaza stock positivo en creación, edición y ajuste de inventario', async () => {
    user.role = 'admin';
    expect((await auth('post', '/productos').send({ ...producto(), stock: 2 })).status).toBe(400);
    expect((await auth('put', `/productos/${pid}`).send({ ...producto(), stock: 2 })).status).toBe(400);
    expect((await auth('put', `/productos/${pid}/stock`).send({ stock: 2 })).status).toBe(400);
    expect(Producto.create).not.toHaveBeenCalled(); expect(Producto.findByIdAndUpdate).not.toHaveBeenCalled();
  });
  test('solo admin puede eliminar; cliente no puede crear ni editar', async () => {
    expect((await auth('post', '/productos').send(producto())).status).toBe(403);
    expect((await auth('put', `/productos/${pid}`).send(producto())).status).toBe(403);
    user.role = 'editor'; expect((await auth('delete', `/productos/${pid}`)).status).toBe(403);
    user.role = 'admin'; expect((await auth('delete', `/productos/${pid}`)).status).toBe(200);
  });
  test('encargo y carrito rechazan productos que recuperaron stock', async () => {
    Producto.find.mockImplementation(() => query([{ _id: pid, nombre: 'Medicamento', precio: 100, stock: 2 }]));
    expect((await auth('post', '/encargos').send(payload())).status).toBe(409);
    expect((await auth('post', '/carrito/sync').send({ items: [{ id: pid, cantidad: 1, modo: 'encargo' }] })).status).toBe(409);
    Producto.findById.mockImplementation(() => query({ _id: pid, stock: 2 }));
    expect((await auth('post', `/carrito/${pid}`).send({ cantidad: 1, modo: 'encargo' })).status).toBe(409);
    expect(Encargo.create).not.toHaveBeenCalled();
  });
  test('un exclusivo no puede guardarse en el carrito de compra', async () => {
    Producto.find.mockImplementation(() => query([{ _id: pid, nombre: 'Especial', precio: 1000, stock: 0, solo_encargo: true }]));
    expect((await auth('post', '/carrito/sync').send({ items: [{ id: pid, cantidad: 1, modo: 'compra' }] })).status).toBe(409);
    expect((await auth('post', `/carrito/${pid}`).send({ cantidad: 1 })).status).toBe(409);
  });
});

test('un producto eliminado queda como conflicto y no se pierde silenciosamente', async () => {
  Producto.find.mockImplementation(() => query([]));
  const res = await auth('post', '/carrito/sync').send({ items: [{ id: pid, cantidad: 1 }] });
  expect(res.status).toBe(409); expect(res.body.conflicts[0]).toMatchObject({ id: pid, motivo: 'eliminado', puedeEncargar: false });
  expect(user.save).not.toHaveBeenCalled();
});
test('persistir encargo genera notificación dirigida a su propietario', async () => {
  await auth('post', '/encargos').send(payload());
  expect(require('../src/services/notifications').notify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: uid, tipo: 'encargo', referenciaId: eid, estado: 'pendiente' }));
});
