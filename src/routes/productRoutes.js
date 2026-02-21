const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { buscarProductos, obtenerTodos, actualizarStock, crearProducto, editarProducto, eliminarProducto, obtenerStock } = require('../controllers/productController');
// configurar multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../public/uploads/')); // Tu directorio de imágenes
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage });

// Ruta para obtener todo el catálogo
router.get('/', obtenerTodos);

// Ruta para el Buscador (Simple y Avanzado)
router.get('/buscar', buscarProductos);

// Actualizar el Stock de un producto 
router.put('/:id/stock', actualizarStock);

// Cear producto
router.post('/', upload.single('imagen'), crearProducto);

// Editar producto
router.put('/:id', upload.single('imagen'), editarProducto);

// Eliminar producto
router.delete('/:id', eliminarProducto);

// Obtener solo el Stock de un producto
router.get('/:id/stock', obtenerStock);

module.exports = router;