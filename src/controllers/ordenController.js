const crearPedido = async (req, res) => {
    try {
        const { cliente, productos, total } = req.body;

        // 1. Guardar en Base de Datos SQL
        const nuevoPedido = await PedidoModel.create({ ...req.body }); 

        // 2. Obtener la instancia de IO
        const io = req.app.get('socketio');

        // 3. Emitir evento a la sala de staff
        io.to('sala_pedidos').emit('nuevo_pedido_notificacion', {
            mensaje: '¡Nuevo encargo recibido!',
            pedidoId: nuevoPedido.id,
            cliente: cliente,
            hora: new Date()
        });

        res.status(201).json({ ok: true, mensaje: 'Pedido creado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al crear pedido' });
    }
};