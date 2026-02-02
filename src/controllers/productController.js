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

module.exports = {
    buscarProductos,
    obtenerTodos
};