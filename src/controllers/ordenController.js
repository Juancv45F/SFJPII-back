const { notify } = require('../services/notifications');
const mongoose = require('mongoose');
const Pedido = require('../models-mongo/pedido');
const Producto = require('../models-mongo/product');
const User = require('../models-mongo/user');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const { resolverPromocion, sincronizarPromociones } = require('../services/promotionInventory');


let fcmAccessTokenCache = { token: '', expiresAt: 0 };
let fcmServiceAccountCache = null;

function base64UrlEncode(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function getFcmServiceAccount() {
    if (fcmServiceAccountCache) return fcmServiceAccountCache;

    let rawJson = process.env.FCM_SERVICE_ACCOUNT_JSON;
    if (!rawJson && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        rawJson = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
    }

    if (!rawJson) {
        throw new Error('FCM service account faltante. Define FCM_SERVICE_ACCOUNT_JSON o GOOGLE_APPLICATION_CREDENTIALS');
    }

    const parsed = JSON.parse(rawJson);
    if (!parsed.client_email || !parsed.private_key) {
        throw new Error('FCM service account inválida: faltan client_email/private_key');
    }

    parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
    fcmServiceAccountCache = parsed;
    return parsed;
}

async function getFcmAccessToken() {
    const nowSec = Math.floor(Date.now() / 1000);
    if (fcmAccessTokenCache.token && fcmAccessTokenCache.expiresAt - 60 > nowSec) {
        return fcmAccessTokenCache.token;
    }

    const sa = getFcmServiceAccount();
    const iat = nowSec;
    const exp = iat + 3600;
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat,
        exp
    };

    const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsignedToken);
    signer.end();
    const signature = signer.sign(sa.private_key, 'base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    const assertion = `${unsignedToken}.${signature}`;

    const tokenResp = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion
        }).toString(),
        {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 8000
        }
    );

    const accessToken = tokenResp?.data?.access_token;
    const expiresIn = Number(tokenResp?.data?.expires_in || 3600);
    if (!accessToken) throw new Error('No se pudo obtener access_token de Google OAuth');

    fcmAccessTokenCache = {
        token: accessToken,
        expiresAt: nowSec + expiresIn
    };
    return accessToken;
}

function getFcmProjectId() {
    if (process.env.FCM_PROJECT_ID) return process.env.FCM_PROJECT_ID;
    const sa = getFcmServiceAccount();
    if (sa.project_id) return sa.project_id;
    throw new Error('FCM_PROJECT_ID faltante y project_id no presente en service account');
}

function isTokenRevokableFromFcmV1Error(errorData) {
    const details = errorData?.error?.details;
    if (!Array.isArray(details)) return false;
    return details.some(d => d && d.errorCode === 'UNREGISTERED');
}

function normalizeFcmData(data) {
    if (!data || typeof data !== 'object') return {};
    const out = {};
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined || value === null) continue;
        out[String(key)] = typeof value === 'string' ? value : String(value);
    }
    return out;
}

async function sendFcmToTokens({ tokens, notification, data }) {
    const cleanTokens = Array.from(new Set((tokens || []).filter(Boolean).map(t => String(t))));
    if (!cleanTokens.length) return { invalidTokens: [], success: 0, failure: 0, errors: [] };

    const invalidTokens = [];
    const errors = [];
    let success = 0;
    let failure = 0;
    let accessToken = '';
    let projectId = '';

    try {
        accessToken = await getFcmAccessToken();
        projectId = getFcmProjectId();
    } catch (err) {
        return {
            invalidTokens,
            success,
            failure: cleanTokens.length,
            errors: [{
                message: err?.message || 'fcm_auth_error',
                status: err?.response?.status,
                response: err?.response?.data
            }]
        };
    }

    for (const token of cleanTokens) {
        try {
            await axios.post(
                `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
                {
                    message: {
                        token,
                        notification,
                        data: normalizeFcmData(data),
                        android: {
                            priority: 'HIGH'
                        }
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 8000
                }
            );
            success += 1;
        } catch (err) {
            failure += 1;
            if (isTokenRevokableFromFcmV1Error(err?.response?.data)) {
                invalidTokens.push(token);
            }
            errors.push({
                message: err?.message || 'fcm_send_error',
                status: err?.response?.status,
                response: err?.response?.data
            });
        }
    }

    return { invalidTokens, success, failure, errors };
}

async function revokeUserTokens(userId, tokens) {
    const invalid = Array.from(new Set((tokens || []).filter(Boolean).map(t => String(t))));
    if (!invalid.length) return;
    const now = new Date();
    await User.updateOne(
        { _id: userId },
        { $set: { 'pushTokens.$[t].revokedAt': now } },
        { arrayFilters: [{ 't.token': { $in: invalid } }] }
    ).exec();
}

async function sendPushToUser({ userId, title, body, data }) {
    const user = await User.findById(String(userId)).select('pushTokens').exec();
    if (!user || !Array.isArray(user.pushTokens)) return;
    const tokens = user.pushTokens.filter(t => t && !t.revokedAt).map(t => t.token);
    const result = await sendFcmToTokens({
        tokens,
        notification: { title, body },
        data: data || {}
    });
    if (result.invalidTokens.length) {
        await revokeUserTokens(String(userId), result.invalidTokens);
    }
    if (Array.isArray(result.errors) && result.errors.length) {
        try { console.error('[PUSH] Errores al enviar push a usuario', { userId: String(userId), errors: result.errors }); } catch {}
    }
}

async function sendPushToAdmins({ title, body, data }) {
    const admins = await User.find({ role: 'admin' }).select('pushTokens').exec();
    if (!Array.isArray(admins) || !admins.length) return;
    for (const admin of admins) {
        const tokens = Array.isArray(admin.pushTokens) ? admin.pushTokens.filter(t => t && !t.revokedAt).map(t => t.token) : [];
        const result = await sendFcmToTokens({
            tokens,
            notification: { title, body },
            data: data || {}
        });
        if (result.invalidTokens.length) {
            await revokeUserTokens(String(admin._id), result.invalidTokens);
        }
        if (Array.isArray(result.errors) && result.errors.length) {
            try { console.error('[PUSH] Errores al enviar push a admin', { adminId: String(admin._id), errors: result.errors }); } catch {}
        }
    }
}

function getMensajeEstadoCliente(estado) {
    switch (String(estado || '').toLowerCase()) {
        case 'pendiente': return 'Tu pedido está pendiente de confirmación';
        case 'pagado': return 'Tu pedido fue marcado como pagado';
        case 'en_camino': return 'Tu pedido está en camino';
        case 'enviado': return 'Tu pedido está en camino';
        case 'entregado': return 'Tu pedido ha sido entregado';
        case 'cancelado': return 'Tu pedido ha sido cancelado';
        default: return '';
    }
}

const crearPedido = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        const { productos, ubicacionId, metodo_pago, tipo_entrega = 'domicilio' } = req.body;
        const userId = req.uid;

        if (!['domicilio', 'recoger'].includes(tipo_entrega)) {
            return res.status(400).json({ message: 'Tipo de entrega no válido' });
        }

        if (!productos || productos.length === 0) {
            return res.status(400).json({ message: 'El carrito está vacío' });
        }

        const usuario = await User.findById(userId).exec();
        if (!usuario) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        const ids = productos.map(p => String(p.id));
        const existentes = await Producto.find({ _id: { $in: ids } }).select('_id nombre').exec();
        const encontrados = new Set(existentes.map(p => String(p._id)));
        const faltantes = ids.filter(id => !encontrados.has(String(id)));
        if (faltantes.length > 0) {
            return res.status(400).json({
                ok: false,
                message: `Productos inexistentes: ${faltantes.join(', ')}`
            });
        }

        let ubicacionSnap;
        if (tipo_entrega === 'domicilio' && ubicacionId !== undefined && usuario.ubicaciones && usuario.ubicaciones.length > 0) {
            // A) Buscar por ObjectId si el cliente envió un ID de subdocumento
            if (mongoose.isValidObjectId(String(ubicacionId))) {
                const sub = usuario.ubicaciones.id(String(ubicacionId)) || usuario.ubicaciones.find(u => String(u?._id) === String(ubicacionId));
                if (sub) {
                    ubicacionSnap = {
                        calle: sub.calle,
                        numero: sub.numero,
                        codigo_postal: sub.codigo_postal,
                        descripcion: sub.descripcion,
                        alias: sub.alias
                    };
                }
            }
            // B) Fallback: índice numérico
            if (!ubicacionSnap) {
                const idx = Number(ubicacionId);
                if (Number.isInteger(idx) && usuario.ubicaciones[idx]) {
                    const u = usuario.ubicaciones[idx];
                    ubicacionSnap = {
                        calle: u.calle,
                        numero: u.numero,
                        codigo_postal: u.codigo_postal,
                        descripcion: u.descripcion,
                        alias: u.alias
                    };
                }
            }
        }
        if (tipo_entrega === 'domicilio' && !ubicacionSnap && req.body.ubicacion) {
            const u = req.body.ubicacion;
            if (u && u.calle && u.numero && u.codigo_postal) {
                ubicacionSnap = {
                    calle: u.calle,
                    numero: u.numero,
                    codigo_postal: u.codigo_postal,
                    descripcion: u.descripcion,
                    alias: u.alias
                };
            }
        }
        if (tipo_entrega === 'domicilio' && !ubicacionSnap) {
            return res.status(400).json({ message: 'Ubicación no válida' });
        }

        const io = req.app.get('socketio');
        const items = [];
        let total = 0;
        let savedPedidoId = '';
        let clienteNombre = '';
        let direccionTexto = '';
        const stockEvents = new Map();

        await session.withTransaction(async () => {
            for (const item of productos) {
                const prod = await Producto.findById(item.id).session(session).exec();
                if (!prod) throw new Error(`El producto con ID ${item.id} no existe.`);
                if (prod.solo_encargo) throw new Error('Producto exclusivo por encargo: no existe para compra inmediata.');

                const { productoInventario, unidades, esPromocion } = await resolverPromocion(prod, { session });
                const unidadesRequeridas = Number(item.cantidad) * unidades;
                const actualizadoInventario = await Producto.findOneAndUpdate(
                    {
                        _id: productoInventario._id,
                        solo_encargo: { $ne: true },
                        stock: { $gte: unidadesRequeridas }
                    },
                    { $inc: { stock: -unidadesRequeridas } },
                    { new: true, session }
                ).exec();
                if (!actualizadoInventario) {
                    const disponibles = esPromocion
                        ? Math.floor(Number(productoInventario.stock || 0) / unidades)
                        : Number(productoInventario.stock || 0);
                    throw new Error(`Stock insuficiente para: ${prod.nombre}. Disponibles: ${disponibles}`);
                }

                stockEvents.set(String(actualizadoInventario._id), Number(actualizadoInventario.stock));
                const promociones = await sincronizarPromociones(
                    actualizadoInventario._id,
                    actualizadoInventario.stock,
                    { session }
                );
                promociones.forEach(({ productoId, nuevoStock }) => stockEvents.set(productoId, nuevoStock));

                const descuento = Number(prod.descuento || 0);
                const precio_unitario = (descuento > 0) 
                    ? prod.precio * (1 - (descuento / 100))
                    : prod.precio;
                
                const subtotal = precio_unitario * item.cantidad;
                total += subtotal;

                items.push({
                    productoId: prod._id,
                    nombre: prod.nombre,
                    imagen: prod.imagen,
                    precio_unitario,
                    cantidad: item.cantidad,
                    subtotal,
                    descuento: descuento // Guardamos el descuento aplicado
                });
            }

            const nuevoPedido = await Pedido.create([{
                total,
                estado: 'pendiente',
                metodo_pago: metodo_pago || 'efectivo',
                tipo_entrega,
                userId,
                ...(ubicacionSnap ? { ubicacion: ubicacionSnap } : {}),
                items
            }], { session });

            const saved = nuevoPedido[0];
            savedPedidoId = String(saved._id);
            clienteNombre = `${usuario.nombre} ${usuario.apellido}`.trim();
            direccionTexto = tipo_entrega === 'recoger'
                ? 'Recoger en farmacia'
                : `${ubicacionSnap.calle} #${ubicacionSnap.numero}, ${ubicacionSnap.alias || ''}`.trim();

            if (io) {
                for (const [productoId, nuevoStock] of stockEvents) {
                    io.emit('stock_actualizado', {
                        productoId,
                        nuevoStock
                    });
                }
                const notificacionData = {
                    mensaje: '¡Nuevo pedido recibido!',
                    pedidoId: savedPedidoId,
                    cliente: clienteNombre,
                    direccion: direccionTexto,
                    total,
                    productos: items.map(i => ({ nombre: i.nombre, cantidad: i.cantidad })),
                    hora: new Date()
                };
                io.to('sala_pedidos').emit('nuevo_pedido_notificacion', notificacionData);
            }

            if (req.logger) {
                req.logger.info('pedido_creado', {
                    context: {
                        pedidoId: String(saved._id),
                        total,
                        productos: productos.map(p => ({ id: p.id, cantidad: p.cantidad }))
                    }
                });
            }
        });

        if (savedPedidoId) {
            await notify(req, { userId, tipo: 'pedido', referenciaId: savedPedidoId, estado: 'pendiente', titulo: 'Pedido recibido', mensaje: 'Tu pedido fue recibido y está en estado pendiente.' });
            await sendPushToUser({
                userId,
                title: 'Pedido creado',
                body: 'Tu pedido fue recibido y está en estado pendiente.',
                data: { pedidoId: savedPedidoId, tipo: 'pedido_creado' }
            });
            await sendPushToAdmins({
                title: 'Nuevo pedido',
                body: `${clienteNombre || 'Cliente'} creó un pedido.`,
                data: { pedidoId: savedPedidoId, tipo: 'nuevo_pedido', cliente: clienteNombre, direccion: direccionTexto, total }
            });
        }

        res.status(201).json({
            ok: true,
            message: 'Pedido realizado con éxito'
        });
    } catch (error) {
        if (req.logger) {
            req.logger.error('pedido_error', { context: { message: error.message, stack: error.stack } });
        }
        const msg = String(error.message || '').toLowerCase();
        if (msg.includes('stock insuficiente')) {
            return res.status(409).json({ ok: false, message: error.message });
        }
        if (msg.includes('no existe') || msg.includes('inexistent') || msg.includes('inexistente')) {
            return res.status(400).json({ ok: false, message: error.message });
        }
        res.status(500).json({
            ok: false,
            message: error.message || 'Error interno al procesar el pedido'
        });
    } finally {
        session.endSession();
    }
};

const obtenerPedidos = async (req, res) => {
    try {
        const role = String(req.rol || '').toLowerCase();
        const filter = role === 'cliente' ? { userId: req.uid } : {};

        const pedidos = await Pedido.find(filter)
            .populate('userId', 'nombre apellido email telefono')
            .sort({ createdAt: -1 })
            .exec();
        res.json({ ok: true, data: pedidos });
    } catch (error) {
        res.status(500).json({ 
            ok: false,
            message: 'Error al obtener pedidos',
            error: error.message
        });
    }
};

const obtenerPedidoPorId = async (req, res) => {
    const { id } = req.params;

    try {
        const role = String(req.rol || '').toLowerCase();
        const pedido = await Pedido.findById(id)
            .populate('userId', 'nombre apellido email telefono')
            .exec();

        if (!pedido) {
            return res.status(404).json({
                ok: false,
                message: 'Pedido no encontrado'
            });
        }

        if (role === 'cliente' && String(pedido.userId?._id || pedido.userId) !== String(req.uid)) {
            return res.status(403).json({
                ok: false,
                message: 'No tienes permisos para ver este pedido'
            });
        }

        res.json({
            ok: true,
            data: pedido
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            message: 'Error al obtener el detalle del pedido'
        });
    }
};

const actualizarEstadoPedido = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;
        const validos = ['pendiente', 'pagado', 'en_camino', 'enviado', 'entregado', 'cancelado'];

        if (!validos.includes(estado)) {
            return res.status(400).json({ ok: false, message: 'Estado no válido' });
        }

        // Buscar el pedido primero para verificar pertenencia si es cliente
        const pedidoExistente = await Pedido.findById(id).exec();

        if (!pedidoExistente) {
            return res.status(404).json({ ok: false, message: 'Pedido no encontrado' });
        }

        const role = String(req.rol || '').toLowerCase();
        
        // REGLAS DE SEGURIDAD PARA CLIENTE
        if (role === 'cliente') {
            // 1. Solo puede cancelar sus propios pedidos
            if (String(pedidoExistente.userId) !== String(req.uid)) {
                return res.status(403).json({ ok: false, message: 'No tienes permiso para modificar este pedido' });
            }
            // 2. Solo puede cambiar el estado a 'cancelado'
            if (estado !== 'cancelado') {
                return res.status(403).json({ ok: false, message: 'Los clientes solo pueden cancelar pedidos' });
            }
            // 3. Solo puede cancelar si el pedido aún está 'pendiente'
            if (pedidoExistente.estado !== 'pendiente') {
                return res.status(400).json({ ok: false, message: 'No se puede cancelar un pedido que ya ha sido procesado o enviado' });
            }
        }

        const pedido = await Pedido.findByIdAndUpdate(id, { estado }, { new: true })
            .populate('userId', 'nombre apellido email telefono')
            .exec();

        const io = req.app.get('socketio');
        if (io) {
            // 1. Notificación general de actualización (para UI que necesiten refrescar listas)
            io.to('sala_pedidos').to(String(pedido.userId?._id || pedido.userId)).emit('pedido_actualizado', {
                pedidoId: String(pedido._id),
                nuevoEstado: estado
            });

            // 2. Notificación específica para el cliente (Push simulado)
            // Se asume que el cliente escucha en una sala con su userId
            const clienteId = String(pedido.userId?._id || pedido.userId);
            const mensajeCliente = getMensajeEstadoCliente(estado);
            if (mensajeCliente) {
                io.to(clienteId).emit('notificacion_push_cliente', {
                    titulo: 'Actualización de Pedido',
                    mensaje: mensajeCliente,
                    pedidoId: String(pedido._id),
                    estado
                });
            }

            // 3. Si el pedido fue cancelado por el cliente, notificar al staff
            // Nota: req.rol nos dice quién está haciendo la petición
            const esCliente = String(req.rol).toLowerCase() === 'cliente';
            if (estado === 'cancelado' && esCliente) {
                io.to('sala_pedidos').emit('nuevo_pedido_notificacion', {
                    mensaje: '⚠️ Un pedido ha sido CANCELADO por el cliente',
                    pedidoId: String(pedido._id),
                    cliente: `${pedido.userId?.nombre} ${pedido.userId?.apellido}`,
                    total: pedido.total,
                    hora: new Date(),
                    tipo: 'cancelacion'
                });
            }
        }

        const clienteId = String(pedido.userId?._id || pedido.userId);
        await notify(req, { userId: clienteId, tipo: 'pedido', referenciaId: pedido._id, estado, titulo: 'Actualización de pedido', mensaje: getMensajeEstadoCliente(estado) || ('Tu pedido cambió a ' + estado) });
        if (estado) {
            const mensajeCliente = getMensajeEstadoCliente(estado);
            if (mensajeCliente) {
                await sendPushToUser({
                    userId: clienteId,
                    title: 'Actualización de Pedido',
                    body: mensajeCliente,
                    data: { pedidoId: String(pedido._id), estado, tipo: 'pedido_actualizado' }
                });
            }
        }

        res.json({ ok: true, message: 'Estado actualizado', data: pedido });
    } catch (error) {
        res.status(500).json({ ok: false, message: 'Error al actualizar pedido' });
    }
};

module.exports = {
    crearPedido,
    obtenerPedidos,
    obtenerPedidoPorId,
    actualizarEstadoPedido
};
