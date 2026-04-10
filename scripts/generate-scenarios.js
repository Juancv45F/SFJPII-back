const axios = require('axios');

const base = 'http://localhost:3000';

async function tryReq(fn, label) {
  try {
    const res = await fn();
    console.log(`[OK] ${label} -> ${res.status}`);
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    console.log(`[ERR] ${label} -> ${status || 'error'}`);
    return null;
  }
}

async function run() {
  // 1) 5 requests a '/'
  for (let i = 1; i <= 5; i++) {
    await tryReq(() => axios.get(`${base}/`, { headers: { 'x-correlation-id': `root-${i}` } }), `GET / (${i})`);
  }

  // 2) 5 requests a '/api/productos'
  for (let i = 1; i <= 5; i++) {
    await tryReq(() => axios.get(`${base}/api/productos`), `GET /api/productos (${i})`);
  }

  // 3) 5 búsquedas
  const qList = ['aspirin', 'vitamina', 'gel', 'na', '*'];
  for (const q of qList) {
    await tryReq(() => axios.get(`${base}/api/productos/buscar`, { params: { q } }), `GET /api/productos/buscar?q=${q}`);
  }

  // 4) 3 errores de validación (400) en creación de producto
  for (let i = 1; i <= 3; i++) {
    await tryReq(() => axios.post(`${base}/api/productos`, { nombre: '', precio: -1, stock: -5 }), `POST /api/productos (invalid ${i})`);
  }

  // 5) 404
  await tryReq(() => axios.get(`${base}/nope`), `GET /nope`);
  await tryReq(() => axios.get(`${base}/api/productos/999999/stock`), `GET /api/productos/999999/stock`);

  // 6) 500 explícito
  await tryReq(() => axios.get(`${base}/api/debug/error`), `GET /api/debug/error`);

  // 7) Latencias altas
  await tryReq(() => axios.get(`${base}/api/debug/delay`, { params: { ms: 700 } }), `GET /api/debug/delay?ms=700`);
  await tryReq(() => axios.get(`${base}/api/debug/delay`, { params: { ms: 1200 } }), `GET /api/debug/delay?ms=1200`);

  // 8) Crear 5 productos válidos
  const createdIds = [];
  for (let i = 1; i <= 5; i++) {
    const pname = `ProductoDemo${i}-${Date.now()}`;
    const data = await tryReq(() => axios.post(`${base}/api/productos`, {
      nombre: pname, descripcion: 'demo', precio: 10 + i, stock: 100 + i, categoriaId: 1
    }), `POST /api/productos (${pname})`);
    if (data?.data?.id) createdIds.push(data.data.id);
  }

  // 9) Actualizar stock de 2 productos
  for (const id of createdIds.slice(0, 2)) {
    await tryReq(() => axios.put(`${base}/api/productos/${id}/stock`, { stock: 50 }), `PUT /api/productos/${id}/stock`);
  }

  // 10) Editar 1 producto
  if (createdIds[0]) {
    const id = createdIds[0];
    await tryReq(() => axios.put(`${base}/api/productos/${id}`, {
      nombre: 'ProductoEditado', descripcion: 'edit', precio: 20, descuento: 2, stock: 80, categoriaId: 1
    }), `PUT /api/productos/${id}`);
  }

  // 11) Eliminar 1 producto
  if (createdIds[1]) {
    const id = createdIds[1];
    await tryReq(() => axios.delete(`${base}/api/productos/${id}`), `DELETE /api/productos/${id}`);
  }

  console.log('Escenarios ejecutados.');
}

run().catch(err => {
  console.error('Escenarios error:', err.message);
});
