const express = require('express');
const router = express.Router();
const multer = require('multer');
const { buscarProductos, obtenerTodos, actualizarStock, crearProducto, editarProducto, eliminarProducto, obtenerStock } = require('../controllers/productController');
const { validateToken, authorizeRoles } = require('../middlewares/validateToken');
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de archivo no permitido. Solo imágenes.'));
        }
    }
});

// Ruta para obtener todo el catálogo
router.get('/', obtenerTodos);

// Ruta para el Buscador (Simple y Avanzado)
router.get('/buscar', buscarProductos);

// Actualizar el Stock de un producto 
router.put('/:id/stock', [validateToken, authorizeRoles('admin', 'editor')], actualizarStock);

// Cear producto
router.post('/', [validateToken, authorizeRoles('admin', 'editor'), upload.single('imagen')], crearProducto);

// Editar producto
router.put('/:id', [validateToken, authorizeRoles('admin', 'editor'), upload.single('imagen')], editarProducto);

// Eliminar producto
router.delete('/:id', [validateToken, authorizeRoles('admin')], eliminarProducto);

// Obtener solo el Stock de un producto
router.get('/:id/stock', obtenerStock);

module.exports = router;
