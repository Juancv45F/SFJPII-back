const express = require('express');
const router = express.Router();
const { buscarProductos, obtenerTodos, actualizarStock, obtenerStock } = require('../controllers/productController');

// Ruta para obtener todo el catálogo
router.get('/', obtenerTodos);

// Ruta para el Buscador (Simple y Avanzado)
router.get('/buscar', buscarProductos);

router.put('/:id/stock', actualizarStock);

router.get('/:id/stock', obtenerStock);

module.exports = router;