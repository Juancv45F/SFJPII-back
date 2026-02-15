const { sequelize } = require('../config/database');
const models = require('../models/index');
const { Pedido, DetallePedido, Producto, User, Ubicacion } = models;


const crearPedido = async (req, res) => {
    // 1. Iniciar Transacción (Seguridad de datos)
    const t = await sequelize.transaction();

    try {
        const { productos, total, ubicacionId, metodo_pago } = req.body;
        const userId = req.uid; 

        // --- VALIDACIONES PREVIAS ---
        if (!productos || productos.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'El carrito está vacío' });
        }

        // 2. Obtener datos del Cliente y Ubicación
        const usuario = await User.findByPk(userId);
        const ubicacion = await Ubicacion.findByPk(ubicacionId);

        if (!ubicacion) {
            await t.rollback();
            return res.status(400).json({ message: 'Ubicación no válida' });
        }

        // 3. Crear la Cabecera del Pedido
        const nuevoPedido = await Pedido.create({
            total: total,
            estado: 'pendiente',
            metodo_pago: metodo_pago || 'efectivo',
            userId: userId,
            ubicacionId: ubicacionId
        }, { transaction: t });

        // 4. Procesar Productos (Detalles y Stock)
        const productosNotificacion = []; 
        const io = req.app.get('socketio');

        for (const item of productos) {
            const productoDB = await Producto.findByPk(item.id, { transaction: t });

            if (!productoDB) {
                throw new Error(`El producto con ID ${item.id} no existe.`);
            }

            if (productoDB.stock < item.cantidad) {
                throw new Error(`Stock insuficiente para: ${productoDB.nombre}. Disponibles: ${productoDB.stock}`);
            }

            // A. Crear registro en DetallePedido
            await DetallePedido.create({
                cantidad: item.cantidad,
                precio_unitario: item.precio,
                subtotal: item.cantidad * item.precio,
                pedidoId: nuevoPedido.id,
                productoId: productoDB.id
            }, { transaction: t });

            // B. Descontar Stock en BD
            await productoDB.decrement('stock', { by: item.cantidad, transaction: t });

            // C. CORRECCIÓN CRÍTICA: Recargar el producto para obtener el stock REAL post-decremento
            await productoDB.reload({ transaction: t });

            // D. Emitir actualización de stock REAL a TODOS los usuarios
            if (io) {
                io.emit('stock_actualizado', {
                    productoId: productoDB.id,
                    nuevoStock: productoDB.stock // Valor exacto de la base de datos
                });
            }

            productosNotificacion.push({
                nombre: productoDB.nombre,
                cantidad: item.cantidad
            });
        }

        // 5. Confirmar Transacción (Guardar todo en BD)
        await t.commit();

        // 6. Notificación de Nuevo Pedido para Staff (Admins/Repartidores)
        try {
            if (io) {
                const notificacionData = {
                    mensaje: '¡Nuevo pedido recibido!',
                    pedidoId: nuevoPedido.id,
                    cliente: `${usuario.nombre} ${usuario.apellido}`,
                    direccion: `${ubicacion.calle} #${ubicacion.numero}, ${ubicacion.alias}`,
                    total: total,
                    productos: productosNotificacion,
                    hora: new Date()
                };

                io.to('sala_pedidos').emit('nuevo_pedido_notificacion', notificacionData);
            }
        } catch (socketError) {
            console.error('Error enviando socket de notificación:', socketError);
        }

        // 7. Respuesta Final
        res.status(201).json({ 
            ok: true, 
            message: 'Pedido realizado con éxito', 
            pedidoId: nuevoPedido.id 
        });

    } catch (error) {
        // Si algo falló antes del commit, deshacemos todo
        if (!t.finished) {
            await t.rollback();
        }
        console.error('Error al crear pedido:', error);
        res.status(500).json({ 
            ok: false, 
            message: error.message || 'Error interno al procesar el pedido' 
        });
    }
};

// --- (Opcional) Controlador para que el Admin vea los pedidos al entrar ---
const obtenerPedidos = async (req, res) => {
    try {
        const pedidos = await Pedido.findAll({
            include: [
                { 
                    model: User, 
                    attributes: ['nombre', 'apellido', 'email'] 
                },
                { 
                    model: Ubicacion 
                },
                { 
                    model: DetallePedido,
                    // Si definiste el alias "as: 'detalles'", debes usarlo aquí
                    include: [{ model: Producto, attributes: ['nombre', 'imagen'] }]
                }
            ],
            order: [['createdAt', 'DESC']]
        });
        res.json({ ok: true, data: pedidos });
    } catch (error) {
        // ESTA LÍNEA ES VITAL: Te dirá el error exacto en la terminal de VS Code
        console.error("DETALLE DEL ERROR 500:", error); 
        
        res.status(500).json({ 
            ok: false,
            message: 'Error al obtener pedidos',
            error: error.message // Solo para desarrollo, quítalo en producción
        });
    }
};

const obtenerPedidoPorId = async (req, res) => {
    const { id } = req.params; // Extraemos el ID de la URL

    try {
        const pedido = await Pedido.findByPk(id, {
            include: [
                { 
                    model: User, 
                    attributes: ['nombre', 'apellido', 'email'] 
                },
                { 
                    model: Ubicacion 
                },
                { 
                    model: DetallePedido,
                    include: [{ 
                        model: Producto, 
                        attributes: ['id', 'nombre', 'imagen', 'precio'] 
                    }]
                }
            ]
        });

        if (!pedido) {
            return res.status(404).json({
                ok: false,
                message: `No se encontró el pedido con ID ${id}`
            });
        }

        res.json({
            ok: true,
            data: pedido
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            message: 'Error al obtener el detalle del pedido'
        });
    }
};

module.exports = {
    crearPedido,
    obtenerPedidos,
    obtenerPedidoPorId
};