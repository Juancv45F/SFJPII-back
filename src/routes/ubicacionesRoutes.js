const { Router } = require('express');
const { check } = require('express-validator');
const { obtenerUbicaciones, crearUbicacion } = require('../controllers/ubicacion');
const { validateToken } = require('../middlewares/validateToken'); // Tu middleware de auth
const { validarCampos } = require('../middlewares/validarCampos');

const router = Router();

// RUTA: GET /api/ubicaciones
// Obtener todas las direcciones del usuario logueado
router.get('/', [
    validateToken
], obtenerUbicaciones);

// RUTA: POST /api/ubicaciones
// Guardar una nueva dirección
router.post('/', [
    validateToken,
    check('calle', 'La calle es obligatoria').not().isEmpty(),
    check('numero', 'El número es obligatorio').not().isEmpty(),
    check('codigo_postal', 'El CP es obligatorio').not().isEmpty(),
    validarCampos
], crearUbicacion);

module.exports = router;