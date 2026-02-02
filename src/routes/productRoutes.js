const express = require('express');
const router = express.Router();
const { buscarProductos, obtenerTodos } = require('../controllers/productController');

// Ruta para obtener todo el catálogo
router.get('/', obtenerTodos);

// Ruta para el Buscador (Simple y Avanzado)
router.get('/buscar', buscarProductos);

module.exports = router;