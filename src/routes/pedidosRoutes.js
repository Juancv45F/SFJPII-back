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
    // IDs ahora son ObjectId de Mongo
    check('productos.*.id', 'El ID del producto debe ser un ObjectId válido').isMongoId(),
    check('productos.*.cantidad', 'La cantidad debe ser mayor a 0').isInt({ min: 1 }),
    // el precio del cliente no es vinculante, el servidor recalcula
    
    check('total', 'El total es obligatorio y numérico').isNumeric(),
    check('ubicacionId', 'La ubicación es obligatoria')
      .custom((v) => {
        const mongoose = require('mongoose');
        if (v === undefined || v === null) return false;
        const n = Number(v);
        return (Number.isInteger(n) && n >= 0) || mongoose.isValidObjectId(String(v));
      }),
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
