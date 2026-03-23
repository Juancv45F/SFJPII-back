const mongoose = require('mongoose');
const Pedido = require('../models-mongo/pedido');
const Producto = require('../models-mongo/product');
const User = require('../models-mongo/user');


const crearPedido = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        const { productos, ubicacionId, metodo_pago } = req.body;
        const userId = req.uid;

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
        if (ubicacionId !== undefined && usuario.ubicaciones && usuario.ubicaciones.length > 0) {
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
        if (!ubicacionSnap && req.body.ubicacion) {
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
        if (!ubicacionSnap) {
            return res.status(400).json({ message: 'Ubicación no válida' });
        }

        const io = req.app.get('socketio');
        const items = [];
        let total = 0;

        await session.withTransaction(async () => {
            for (const item of productos) {
                const prod = await Producto.findById(item.id).session(session).exec();
                if (!prod) throw new Error(`El producto con ID ${item.id} no existe.`);

                const updateRes = await Producto.updateOne(
                    { _id: prod._id, stock: { $gte: item.cantidad } },
                    { $inc: { stock: -item.cantidad } }
                ).session(session).exec();
                if (updateRes.modifiedCount === 0) {
                    throw new Error(`Stock insuficiente para: ${prod.nombre}. Disponibles: ${prod.stock}`);
                }

                const precio_unitario = prod.precio;
                const subtotal = precio_unitario * item.cantidad;
                total += subtotal;

                items.push({
                    productoId: prod._id,
                    nombre: prod.nombre,
                    imagen: prod.imagen,
                    precio_unitario,
                    cantidad: item.cantidad,
                    subtotal
                });
            }

            const nuevoPedido = await Pedido.create([{
                total,
                estado: 'pendiente',
                metodo_pago: metodo_pago || 'efectivo',
                userId,
                ubicacion: ubicacionSnap,
                items
            }], { session });

            const saved = nuevoPedido[0];

            if (io) {
                for (const it of items) {
                    const prod = await Producto.findById(it.productoId).session(session).exec();
                    io.emit('stock_actualizado', {
                        productoId: String(it.productoId),
                        nuevoStock: prod ? prod.stock : undefined
                    });
                }
                const notificacionData = {
                    mensaje: '¡Nuevo pedido recibido!',
                    pedidoId: String(saved._id),
                    cliente: `${usuario.nombre} ${usuario.apellido}`,
                    direccion: `${ubicacionSnap.calle} #${ubicacionSnap.numero}, ${ubicacionSnap.alias || ''}`.trim(),
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
            .populate('userId', 'nombre apellido email')
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
            .populate('userId', 'nombre apellido email')
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
        const validos = ['pendiente', 'enviado', 'entregado', 'cancelado'];

        if (!validos.includes(estado)) {
            return res.status(400).json({ ok: false, message: 'Estado no válido' });
        }

        const pedido = await Pedido.findByIdAndUpdate(id, { estado }, { new: true })
            .populate('userId', 'nombre apellido email')
            .exec();

        if (!pedido) {
            return res.status(404).json({ ok: false, message: 'Pedido no encontrado' });
        }

        const io = req.app.get('socketio');
        if (io) {
            io.emit('pedido_actualizado', {
                pedidoId: String(pedido._id),
                nuevoEstado: estado
            });
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
