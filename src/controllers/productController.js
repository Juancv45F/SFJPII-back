const mongoose = require('mongoose');
const Producto = require('../models-mongo/product');
const cloudinary = require('../config/cloudinary');

function normalizeCategoriaInput(categoria, fallbackCategoria, categoriaId) {
    if (!categoria) return fallbackCategoria;

    let categoriaObj;
    try {
        categoriaObj = typeof categoria === 'string' ? JSON.parse(categoria) : categoria;
    } catch (e) {
        categoriaObj = { nombre: categoria, activa: true };
    }

    if (!categoriaObj || typeof categoriaObj !== 'object') {
        return fallbackCategoria;
    }

    const nombre = typeof categoriaObj.nombre === 'string' ? categoriaObj.nombre.trim() : '';
    if (!nombre) return fallbackCategoria;

    const out = {
        nombre,
        descripcion: typeof categoriaObj.descripcion === 'string' ? categoriaObj.descripcion.trim() : '',
        activa: typeof categoriaObj.activa === 'boolean' ? categoriaObj.activa : true
    };

    if (categoriaObj._id && mongoose.Types.ObjectId.isValid(String(categoriaObj._id))) {
        out._id = new mongoose.Types.ObjectId(String(categoriaObj._id));
    } else if (categoriaId && mongoose.Types.ObjectId.isValid(String(categoriaId))) {
        out._id = new mongoose.Types.ObjectId(String(categoriaId));
    } else if (fallbackCategoria && fallbackCategoria._id) {
        out._id = fallbackCategoria._id;
    } else {
        out._id = new mongoose.Types.ObjectId();
    }

    return out;
}

const buscarProductos = async (req, res) => {
    try {
        const { q, categoriaId, precioMin, precioMax } = req.query;
        const filtros = {};
        if (q) filtros.nombre = { $regex: q, $options: 'i' };
        if (precioMin != null || precioMax != null) {
            filtros.precio = {};
            if (precioMin != null) filtros.precio.$gte = Number(precioMin);
            if (precioMax != null) filtros.precio.$lte = Number(precioMax);
        }
        if (categoriaId) {
            filtros['categoria._id'] = categoriaId;
        }
        const productos = await Producto.find(filtros).exec();

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
        res.status(500).json({ message: 'Error en el servidor al buscar productos' });
    }
};

const obtenerTodos = async (req, res) => {
    try {
        const productos = await Producto.find({}).exec();
        res.json({ data: productos });
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener productos' });
    }
};

const actualizarStock = async (req, res) => {
    try {
        const { id } = req.params;
        const { stock } = req.body;

        if (stock === undefined || isNaN(stock) || stock < 0) {
            return res.status(400).json({ message: 'El valor del stock es inválido.' });
        }

        const producto = await Producto.findById(id).exec();
        if (!producto) {
            return res.status(404).json({ message: 'Producto no encontrado.' });
        }

        const actualizado = await Producto.findByIdAndUpdate(
            id,
            { stock: Number(stock) },
            { new: true }
        ).exec();
        
        const io = req.app.get('socketio');
        io.emit('stock_actualizado', {
            productoId: String(actualizado._id),
            nuevoStock: actualizado.stock
        });
        if (req.logger) {
            req.logger.info('stock_actualizado_evento', {
                context: { productoId: String(actualizado._id), nuevoStock: actualizado.stock }
            });
        }
        res.status(200).json({
            message: 'Stock actualizado correctamente.',
            productoId: String(actualizado._id),
            nuevoStock: actualizado.stock
        });
    } catch (error) {
        if (req.logger) {
            req.logger.error('producto_error', { context: { message: error.message, stack: error.stack } });
        }
        res.status(500).json({ message: 'Error al actualizar el stock.' });
    }
};

const obtenerStock = async (req, res) => {
    try {
        const { id } = req.params;

        const producto = await Producto.findById(id).select('nombre stock').exec();

        if (!producto) {
            return res.status(404).json({ message: 'Producto no encontrado.' });
        }

        res.status(200).json({
            id: String(producto._id),
            nombre: producto.nombre,
            stock: producto.stock
        });

    } catch (error) {
        res.status(500).json({ message: 'Error al obtener el stock.' });
    }
};

const obtenerCategorias = async (req, res) => {
    try {
        // Obtenemos las categorías únicas usando agregación para traer también la descripción y el ID
        const categorias = await Producto.aggregate([
            { $match: { 'categoria.nombre': { $exists: true, $ne: null } } },
            { $group: { 
                _id: '$categoria.nombre', 
                nombre: { $first: '$categoria.nombre' },
                descripcion: { $first: '$categoria.descripcion' },
                _id_mongo: { $first: '$categoria._id' },
                activa: { $first: '$categoria.activa' }
            } },
            { $project: { 
                _id: '$_id_mongo', 
                nombre: 1, 
                descripcion: 1,
                activa: 1
            } }
        ]).exec();

        res.json({
            ok: true,
            data: categorias
        });
    } catch (error) {
        console.error('Error al obtener categorías:', error);
        res.status(500).json({ ok: false, message: 'Error al obtener categorías' });
    }
};

const crearProducto = async (req, res) => {
    try {
        const { nombre, descripcion, precio, descuento, stock, categoria, categoriaId } = req.body;
        let imagenUrl;
        if (req.file) {
            const b64 = req.file.buffer.toString('base64');
            const dataURI = `data:${req.file.mimetype};base64,${b64}`;
            const uploadRes = await cloudinary.uploader.upload(dataURI, {
                folder: 'sfjpii/products',
                resource_type: 'image',
                use_filename: true,
                unique_filename: true,
                overwrite: false
            });
            imagenUrl = cloudinary.url(uploadRes.public_id, {
                fetch_format: 'auto',
                quality: 'auto',
                secure: true
            });
        }

        if (!nombre || !precio || !stock) {
            return res.status(400).json({ 
                ok: false, 
                message: 'Faltan campos obligatorios: nombre, precio, stock' 
            });
        }

        const productoExistente = await Producto.findOne({ nombre }).exec();
        if (productoExistente) {
            return res.status(400).json({ 
                ok: false, 
                message: 'Ya existe un producto con ese nombre' 
            });
        }

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

        // Normalizar categoría para garantizar _id requerido por el esquema embebido
        const categoriaObj = normalizeCategoriaInput(categoria, undefined, categoriaId);
        if (!categoriaObj) {
            return res.status(400).json({
                ok: false,
                message: 'La categoría es obligatoria y debe tener al menos un nombre'
            });
        }

        const nuevoProducto = await Producto.create({
            nombre,
            descripcion,
            precio: precioNum,
            descuento: descuentoNum,
            stock: stockNum,
            categoria: categoriaObj,
            imagen: imagenUrl
        });

        if (req.logger) {
            req.logger.info('producto_creado', {
                context: { productoId: String(nuevoProducto._id), nombre: nuevoProducto.nombre, stock: nuevoProducto.stock }
            });
        }
        res.status(201).json({ ok: true, data: nuevoProducto });
    } catch (error) {
        if (req.logger) {
            req.logger.error('producto_error', { context: { message: error.message, stack: error.stack } });
        }
        res.status(500).json({ ok: false, message: 'Error al crear producto' });
    }
};

const editarProducto = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, descripcion, precio, descuento, stock, categoria, categoriaId } = req.body;

        const producto = await Producto.findById(id).exec();

        if (!producto) {
            return res.status(404).json({ ok: false, message: 'Producto no encontrado' });
        }

        if (!nombre || !precio || !stock) {
            return res.status(400).json({ 
                ok: false, 
                message: 'Faltan campos obligatorios: nombre, precio, stock' 
            });
        }

        if (nombre !== producto.nombre) {
            const existente = await Producto.findOne({ nombre }).exec();
            if (existente && String(existente._id) !== String(producto._id)) {
                return res.status(400).json({ 
                    ok: false, 
                    message: 'Ya existe un producto con ese nombre' 
                });
            }
        }

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

        let imagenUrl = producto.imagen;
        if (req.file) {
            const b64 = req.file.buffer.toString('base64');
            const dataURI = `data:${req.file.mimetype};base64,${b64}`;
            const uploadRes = await cloudinary.uploader.upload(dataURI, {
                folder: 'sfjpii/products',
                resource_type: 'image',
                use_filename: true,
                unique_filename: true,
                overwrite: false
            });
            imagenUrl = cloudinary.url(uploadRes.public_id, {
                fetch_format: 'auto',
                quality: 'auto',
                secure: true
            });
        }

        // Normalizar categoría y preservar _id actual si el frontend no lo envía
        const categoriaObj = normalizeCategoriaInput(categoria, producto.categoria, categoriaId);

        const actualizado = await Producto.findByIdAndUpdate(id, {
            nombre,
            descripcion,
            precio: precioNum,
            descuento: descuentoNum,
            stock: stockNum,
            categoria: categoriaObj,
            imagen: imagenUrl
        }, { new: true }).exec();

        const io = req.app.get('socketio');
        if (io) {
            io.emit('producto_actualizado', actualizado);
            io.emit('stock_actualizado', { productoId: String(actualizado._id), nuevoStock: actualizado.stock });
        }
        if (req.logger) {
            req.logger.info('producto_actualizado', {
                context: { productoId: String(actualizado._id), nombre: actualizado.nombre }
            });
        }

        res.json({
            ok: true,
            message: 'Producto actualizado con éxito',
            data: actualizado
        });

    } catch (error) {
        if (req.logger) {
            req.logger.error('producto_error', { context: { message: error.message, stack: error.stack } });
        }
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
        await Producto.findByIdAndDelete(id).exec();
        if (req.logger) {
            req.logger.info('producto_eliminado', { context: { productoId: String(id) } });
        }
        res.json({ ok: true, message: 'Producto eliminado' });
    } catch (error) {
        if (req.logger) {
            req.logger.error('producto_error', { context: { message: error.message, stack: error.stack } });
        }
        res.status(500).json({ ok: false, message: 'Error al eliminar' });
    }
};

const actualizarCategoria = async (req, res) => {
    try {
        const { nombreAntiguo } = req.params;
        const { nombre, descripcion } = req.body;

        if (!nombre) {
            return res.status(400).json({ ok: false, message: 'El nombre es obligatorio' });
        }

        // Actualizar todos los productos que tengan esta categoría
        const resultado = await Producto.updateMany(
            { 'categoria.nombre': nombreAntiguo },
            { 
                $set: { 
                    'categoria.nombre': nombre,
                    'categoria.descripcion': descripcion 
                } 
            }
        ).exec();

        res.json({ 
            ok: true, 
            message: 'Categoría actualizada globalmente', 
            modificados: resultado.modifiedCount 
        });
    } catch (error) {
        res.status(500).json({ ok: false, message: 'Error al actualizar categoría' });
    }
};

const eliminarCategoria = async (req, res) => {
    try {
        const { nombre } = req.params;

        // Eliminar la referencia de categoría en todos los productos
        const resultado = await Producto.updateMany(
            { 'categoria.nombre': nombre },
            { $unset: { categoria: "" } }
        ).exec();

        res.json({ 
            ok: true, 
            message: 'Categoría eliminada globalmente', 
            modificados: resultado.modifiedCount 
        });
    } catch (error) {
        res.status(500).json({ ok: false, message: 'Error al eliminar categoría' });
    }
};

module.exports = {
    buscarProductos,
    obtenerTodos,
    actualizarStock,
    obtenerStock,
    obtenerCategorias,
    crearProducto,
    editarProducto,
    eliminarProducto,
    actualizarCategoria,
    eliminarCategoria
};
