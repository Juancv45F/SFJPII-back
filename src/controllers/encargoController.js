const { notify } = require('../services/notifications');
const Encargo = require('../models-mongo/encargo');
const User = require('../models-mongo/user');
const Producto = require('../models-mongo/product');
const { sendPushToUser } = require('./ordenController');
const {
  puedeCrearEncargo,
  puedeCancelarEncargo,
  cancelableHasta,
  fechaEstimadaLlegada
} = require('../utils/encargoSchedule');

const staff = req => ['admin', 'editor', 'super_admin'].includes(req.rol);
const scope = req => staff(req) ? {} : { userId: req.uid };
const fail = (res, status, message) => res.status(status).json({ ok: false, message });
const now = req => typeof req.app.get('clock') === 'function' ? req.app.get('clock')() : new Date();

async function crear(req, res) {
  try {
    const { productos, tipo_entrega, ubicacionId, solicitudId } = req.body;
    const anterior = await Encargo.findOne({ userId: req.uid, solicitudId }).exec();
    if (anterior) return res.json({ ok: true, data: anterior });
    const creadoEn = now(req);
    if (!puedeCrearEncargo(creadoEn)) {
      return fail(res, 409, 'Los encargos solo se reciben antes de las 10:00 p. m. Inténtalo mañana.');
    }
    const usuario = await User.findById(req.uid).exec();
    if (!usuario) return fail(res, 404, 'Usuario no encontrado');
    let ubicacion;
    if (tipo_entrega === 'domicilio') {
      const u = usuario.ubicaciones.id(ubicacionId);
      if (!u) return fail(res, 400, 'Selecciona una de tus ubicaciones guardadas');
      ubicacion = { ubicacionId: u._id, calle: u.calle, numero: u.numero,
        codigo_postal: u.codigo_postal, descripcion: u.descripcion, alias: u.alias };
    }
    const ids = productos.map(p => p.id.toLowerCase());
    if (new Set(ids).size !== ids.length) return fail(res, 400, 'No repitas medicamentos en el encargo');
    const existentes = await Producto.find({ _id: { $in: ids } }).exec();
    const porId = new Map(existentes.map(p => [String(p._id), p]));
    if (porId.size !== ids.length) return fail(res, 400, 'Uno o más medicamentos ya no existen');
    if (existentes.some(p => Number(p.stock) !== 0)) return fail(res, 409, 'Solo puedes encargar medicamentos sin stock. Compra los disponibles desde el catálogo.');
    const items = productos.map(p => {
      const medicamento = porId.get(p.id.toLowerCase());
      return { productoId: medicamento._id, nombre: medicamento.nombre, imagen: medicamento.imagen,
        cantidad: Number(p.cantidad),
        precio_unitario: Math.round(medicamento.precio * (1 - (medicamento.descuento || 0) / 100) * 100) / 100 };
    });
    // El encargo solicita abastecimiento separado; no consume el stock de venta inmediata.
    const data = await Encargo.create({ userId: req.uid, solicitudId, items, tipo_entrega, ubicacion,
      total_estimado: Math.round(items.reduce((n, p) => n + p.precio_unitario * p.cantidad, 0) * 100) / 100,
      cancelable_hasta: cancelableHasta(creadoEn),
      fecha_estimada_llegada: fechaEstimadaLlegada(creadoEn),
      historial: [{ estado: 'pendiente', usuarioId: req.uid }] });
    await notify(req, { userId: req.uid, tipo: 'encargo', referenciaId: data._id, estado: 'pendiente', titulo: 'Encargo recibido', mensaje: 'Recibimos tu encargo. Te avisaremos cuando llegue.' });
    await sendPushToUser({
      userId: req.uid,
      title: 'Encargo recibido',
      body: 'Recibimos tu encargo. Te avisaremos cuando llegue.',
      data: { encargoId: String(data._id), estado: 'pendiente', tipo: 'encargo_creado' }
    });
    return res.status(201).json({ ok: true, data });
  } catch (err) {
    if (err.code === 11000) {
      const data = await Encargo.findOne({ userId: req.uid, solicitudId: req.body.solicitudId }).exec();
      return res.json({ ok: true, data });
    }
    return fail(res, 500, 'No se pudo guardar el encargo');
  }
}

async function listar(req, res) {
  try {
    const filter = scope(req);
    if (req.query.estado) filter.estado = req.query.estado;
    const data = await Encargo.find(filter).populate('userId', 'nombre apellido email').sort({ createdAt: -1 }).exec();
    return res.json({ ok: true, data });
  } catch { return fail(res, 500, 'No se pudieron cargar los encargos'); }
}

async function detalle(req, res) {
  try {
    const data = await Encargo.findOne({ _id: req.params.id, ...scope(req) }).populate('userId', 'nombre apellido email').exec();
    if (!data) return fail(res, 404, 'Encargo no encontrado');
    return res.json({ ok: true, data });
  } catch { return fail(res, 500, 'No se pudo cargar el encargo'); }
}

async function actualizar(req, res) {
  try {
    const { estado } = req.body;
    const motivo = typeof req.body.motivo_cancelacion === 'string' ? req.body.motivo_cancelacion.trim() : '';
    if (!staff(req) && estado !== 'cancelado') return fail(res, 403, 'Solo puedes cancelar tus propios encargos');
    if (estado === 'cancelado' && (!motivo || motivo.length > 500)) return fail(res, 400, 'Escribe el motivo de cancelación (1 a 500 caracteres)');
    const actual = await Encargo.findOne({ _id: req.params.id, ...scope(req) }).exec();
    if (!actual) return fail(res, 404, 'Encargo no encontrado');
    if (!staff(req) && estado === 'cancelado' && !puedeCancelarEncargo(actual.createdAt, now(req))) {
      return fail(res, 409, 'El plazo de cancelación terminó a las 9:00 p. m. del día en que realizaste el encargo.');
    }
    const siguientes = {
      pendiente: ['disponible', 'cancelado'],
      disponible: [actual.tipo_entrega === 'domicilio' ? 'en_camino' : 'entregado', 'cancelado'],
      en_camino: ['entregado'], entregado: [], cancelado: []
    };
    if (!siguientes[actual.estado].includes(estado)) return fail(res, 409, 'El encargo ya cambió o no permite esa transición');
    const cambios = { estado };
    if (estado === 'cancelado') cambios.motivo_cancelacion = motivo;
    if (estado === 'disponible') cambios.disponibleAt = new Date();
    // Comparar el estado evita sobrescribir una entrega/cancelación concurrente.
    const data = await Encargo.findOneAndUpdate({ _id: actual._id, estado: actual.estado }, {
      $set: cambios, $push: { historial: { estado, fecha: new Date(), usuarioId: req.uid } }
    }, { new: true, runValidators: true }).populate('userId', 'nombre apellido email').exec();
    if (!data) return fail(res, 409, 'El encargo cambió. Actualiza la página e inténtalo de nuevo');
    const mensajes = { disponible: actual.tipo_entrega === 'domicilio' ? 'Tu encargo ya llegó a la farmacia. Prepararemos el envío.' : 'Tu encargo ya llegó. Puedes recogerlo en farmacia.', en_camino: 'Tu encargo está en camino.', entregado: 'Tu encargo fue entregado.', cancelado: 'Tu encargo fue cancelado: ' + motivo };
    await notify(req, { userId: data.userId?._id || data.userId, tipo: 'encargo', referenciaId: data._id, estado, titulo: 'Actualización de encargo', mensaje: mensajes[estado] });
    await sendPushToUser({
      userId: data.userId?._id || data.userId,
      title: 'Actualización de encargo',
      body: mensajes[estado],
      data: { encargoId: String(data._id), estado, tipo: 'encargo_actualizado' }
    });
    req.app.get('socketio')?.to('sala_pedidos').emit('encargo_actualizado', { encargoId: String(data._id) });
    return res.json({ ok: true, data });
  } catch { return fail(res, 500, 'No se pudo actualizar el encargo'); }
}

module.exports = { crear, listar, detalle, actualizar };
