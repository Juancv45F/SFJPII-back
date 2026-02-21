const { Router } = require('express');
const { check } = require('express-validator');

const { crearPedido, obtenerPedidos, obtenerPedidoPorId } = require('../controllers/ordenController');
const { validateToken } = require('../middlewares/validateToken');
const { validarCampos } = require('../middlewares/validarCampos');

const router = Router();

router.post('/', [
    // A. Validar que esté logueado
    validateToken,

    // B. Validaciones de datos 
    check('productos', 'La lista de productos es obligatoria').isArray({ min: 1 }),
    check('productos.*.id', 'El ID del producto es obligatorio').isInt(),
    check('productos.*.cantidad', 'La cantidad debe ser mayor a 0').isInt({ min: 1 }),
    check('productos.*.precio', 'El precio debe ser un número').isNumeric(),
    
    check('total', 'El total es obligatorio y numérico').isNumeric(),
    check('ubicacionId', 'La ubicación es obligatoria').not().isEmpty(),
    // C. Revisar si hubo errores en los checks de arriba
    validarCampos 
], crearPedido);


router.get('/', [
    validateToken
], obtenerPedidos);

router.get('/:id', [
    validateToken
], obtenerPedidoPorId);

module.exports = router;