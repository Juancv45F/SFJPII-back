const { Producto, Categoria } = require('../models');
const { Op } = require('sequelize');

// Controlador unificado para Búsqueda Simple y Avanzada
const buscarProductos = async (req, res) => {
    try {
        // Obtener parámetros de la URL (Query Params)
        const { q, categoriaId, precioMin, precioMax } = req.query;

        // Construir el objeto de filtros dinámicamente
        let filtros = {};

        // Búsqueda Simple (Texto)
        if (q) {
            filtros.nombre = {
                [Op.iLike]: `%${q}%` // iLike es "Insensitive Like" (Ignora mayúsculas en Postgres)
            };
        }

        // Filtros Avanzados
        if (precioMin || precioMax) {
            filtros.precio = {};
            if (precioMin) filtros.precio[Op.gte] = Number(precioMin); // Mayor o igual que
            if (precioMax) filtros.precio[Op.lte] = Number(precioMax); // Menor o igual que
        }

        if (categoriaId) {
            filtros.categoriaId = categoriaId;
        }

        // Ejecutar la consulta en BD
        const productos = await Producto.findAll({
            where: filtros,
            include: [{
                model: Categoria,
                attributes: ['nombre'] // Traer también el nombre de la categoría
            }]
        });

        // Respuesta
        if (productos.length === 0) {
            return res.status(200).json({ 
                message: 'No se encontraron productos con esos criterios',
                data: []
            });
        }

        res.status(200).json({
            message: 'Resultados de la búsqueda',
            cantidad: productos.length,
            data: productos
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el servidor al buscar productos' });
    }
};

const obtenerTodos = async (req, res) => {
    try {
        const productos = await Producto.findAll({
            include: [{ model: Categoria, attributes: ['nombre'] }]
        });
        res.json({ data: productos });
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener productos' });
    }
};

// Actualizar el Stock de un producto 
const actualizarStock = async (req, res) => {
    try {
        const { id } = req.params;
        const { stock } = req.body;

        if (stock === undefined || isNaN(stock) || stock < 0) {
            return res.status(400).json({ message: 'El valor del stock es inválido.' });
        }

        const producto = await Producto.findByPk(id);
        if (!producto) {
            return res.status(404).json({ message: 'Producto no encontrado.' });
        }

        producto.stock = Number(stock);
        await producto.save();
        
        const io = req.app.get('socketio');
        io.emit('stock_actualizado', {
            productoId: producto.id,
            nuevoStock: producto.stock
        });
        res.status(200).json({
            message: 'Stock actualizado correctamente.',
            productoId: producto.id,
            nuevoStock: producto.stock
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al actualizar el stock.' });
    }
};

// Obtener solo el Stock de un producto
const obtenerStock = async (req, res) => {
    try {
        const { id } = req.params;

        const producto = await Producto.findByPk(id, {
            attributes: ['id', 'stock', 'nombre'] // Solo traemos lo necesario
        });

        if (!producto) {
            return res.status(404).json({ message: 'Producto no encontrado.' });
        }

        res.status(200).json({
            id: producto.id,
            nombre: producto.nombre,
            stock: producto.stock
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al obtener el stock.' });
    }
};

const crearProducto = async (req, res) => {
    try {
        const { nombre, descripcion, precio, descuento, stock, categoriaId } = req.body;
        // Construimos la URL de la imagen
        const imagenUrl = req.file ? `http://localhost:3000/uploads/${req.file.filename}` : undefined;

         // Validar campos obligatorios
        if (!nombre || !precio || !stock) {
            return res.status(400).json({ 
                ok: false, 
                message: 'Faltan campos obligatorios: nombre, precio, stock' 
            });
        }

        // Validar que el nombre sea único
        const productoExistente = await Producto.findOne({ where: { nombre } });
        if (productoExistente) {
            return res.status(400).json({ 
                ok: false, 
                message: 'Ya existe un producto con ese nombre' 
            });
        }

        // Convertir a números y validar que no sean negativos
        const precioNum = parseFloat(precio);
        const stockNum = parseInt(stock, 10);
        const descuentoNum = descuento ? parseFloat(descuento) : 0;

        if (isNaN(precioNum) || precioNum < 0) {
            return res.status(400).json({ 
                ok: false, 
                message: 'El precio debe ser un número positivo' 
            });
        }
        if (isNaN(stockNum) || stockNum < 0) {
            return res.status(400).json({ 
                ok: false, 
                message: 'El stock debe ser un número entero no negativo' 
            });
        }
        if (descuento && (isNaN(descuentoNum) || descuentoNum < 0)) {
            return res.status(400).json({ 
                ok: false, 
                message: 'El descuento debe ser un número no negativo' 
            });
        }

        const nuevoProducto = await Producto.create({
            nombre,
            descripcion,
            precio: precioNum,
            descuento: descuentoNum,
            stock: stockNum,
            categoriaId,
            imagen: imagenUrl
        });

        res.status(201).json({ ok: true, data: nuevoProducto });
    } catch (error) {
        res.status(500).json({ ok: false, message: 'Error al crear producto' });
    }
};

const editarProducto = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, descripcion, precio, descuento, stock, categoriaId } = req.body;

        // 1. Buscar el producto existente
        const producto = await Producto.findByPk(id);

        if (!producto) {
            return res.status(404).json({ ok: false, message: 'Producto no encontrado' });
        }

         // Validar campos obligatorios
        if (!nombre || !precio || !stock) {
            return res.status(400).json({ 
                ok: false, 
                message: 'Faltan campos obligatorios: nombre, precio, stock' 
            });
        }

        // Validar nombre único (excepto si es el mismo producto)
        if (nombre !== producto.nombre) {
            const existente = await Producto.findOne({ where: { nombre } });
            if (existente) {
                return res.status(400).json({ 
                    ok: false, 
                    message: 'Ya existe un producto con ese nombre' 
                });
            }
        }

        // Convertir a números y validar no negativos
        const precioNum = parseFloat(precio);
        const stockNum = parseInt(stock, 10);
        const descuentoNum = descuento ? parseFloat(descuento) : 0;

        if (isNaN(precioNum) || precioNum <= 0) {
            return res.status(400).json({ 
                ok: false, 
                message: 'El precio debe ser un número positivo y mayor a 0' 
            });
        }
        if (isNaN(stockNum) || stockNum < 0) {
            return res.status(400).json({ 
                ok: false, 
                message: 'El stock debe ser un número entero no negativo' 
            });
        }
        if (descuento && (isNaN(descuentoNum) || descuentoNum < 0)) {
            return res.status(400).json({ 
                ok: false, 
                message: 'El descuento debe ser un número no negativo' 
            });
        }

        // 2. Si se subió una nueva imagen, actualizamos la ruta
        // Si no se subió nada (req.file es undefined), conservamos la imagen anterior
        const imagenUrl = req.file ? `http://localhost:3000/uploads/${req.file.filename}` : producto.imagen;

        // 3. Actualizar campos
        await producto.update({
            nombre,
            descripcion,
            precio: precioNum,
            descuento: descuentoNum,
            stock: stockNum,
            categoriaId,
            imagen: imagenUrl
        });

        // 4. Emitir por Socket para que todos vean el cambio 
        const io = req.app.get('socketio');
        if (io) {
            io.emit('producto_actualizado', producto);
            // También notificamos el stock por si cambió
            io.emit('stock_actualizado', { productoId: producto.id, nuevoStock: producto.stock });
        }

        res.json({
            ok: true,
            message: 'Producto actualizado con éxito',
            data: producto
        });

    } catch (error) {
        console.error("ERROR AL EDITAR:", error); // Esto aparecerá en tu terminal de VS Code
        res.status(500).json({ 
            ok: false, 
            message: 'Error al editar producto',
            error: error.message 
        });
    }
};

const eliminarProducto = async (req, res) => {
    try {
        const { id } = req.params;
        await Producto.destroy({ where: { id } });
        res.json({ ok: true, message: 'Producto eliminado' });
    } catch (error) {
        res.status(500).json({ ok: false, message: 'Error al eliminar' });
    }
};

module.exports = {
    buscarProductos,
    obtenerTodos,
    actualizarStock,
    obtenerStock,
    crearProducto,
    eliminarProducto,
    editarProducto,
};