const { Router } = require('express');
const { check } = require('express-validator');
const { obtenerUbicaciones, crearUbicacion, actualizarUbicacion, eliminarUbicacion } = require('../controllers/ubicacion');
const { validateToken, authorizeRoles } = require('../middlewares/validateToken'); // Tu middleware de auth
const { validarCampos } = require('../middlewares/validarCampos');

const router = Router();

// RUTA: GET /api/ubicaciones
// Obtener todas las direcciones del usuario logueado
router.get('/', [
    validateToken,
    authorizeRoles('cliente')
], obtenerUbicaciones);

// RUTA: POST /api/ubicaciones
// Guardar una nueva dirección
router.post('/', [
    validateToken,
    authorizeRoles('cliente'),
    check('calle', 'La calle es obligatoria').not().isEmpty(),
    check('numero', 'El número es obligatorio').not().isEmpty(),
    check('codigo_postal', 'El CP es obligatorio').not().isEmpty(),
    validarCampos
], crearUbicacion);

// RUTA: PUT /api/ubicaciones/:id
// Editar una dirección existente
router.put('/:id', [
    validateToken,
    authorizeRoles('cliente'),
    check('calle', 'La calle es obligatoria').not().isEmpty(),
    check('numero', 'El número es obligatorio').not().isEmpty(),
    check('codigo_postal', 'El CP es obligatorio').not().isEmpty(),
    validarCampos
], actualizarUbicacion);

// RUTA: DELETE /api/ubicaciones/:id
// Eliminar una dirección
router.delete('/:id', [
    validateToken,
    authorizeRoles('cliente')
], eliminarUbicacion);

module.exports = router;
