const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { validateToken, authorizeRoles } = require('../middlewares/validateToken');
const { validarCampos } = require('../middlewares/validarCampos');
const controller = require('../controllers/encargoController');
const router = Router();
const estados = ['pendiente', 'disponible', 'en_camino', 'entregado', 'cancelado'];
router.use(validateToken, authorizeRoles('cliente', 'admin', 'editor'));
router.get('/', [query('estado').optional().isIn(estados), validarCampos], controller.listar);
router.post('/', [authorizeRoles('cliente'),
  body('productos').isArray({ min: 1, max: 100 }),
  body('productos.*.id').isMongoId(),
  body('productos.*.cantidad').isInt({ min: 1, max: 999 }),
  body('solicitudId').isUUID(),
  body('tipo_entrega').isIn(['recoger', 'domicilio']),
  body('ubicacionId').if(body('tipo_entrega').equals('domicilio')).isMongoId(),
  validarCampos
], controller.crear);
router.get('/:id', [param('id').isMongoId(), validarCampos], controller.detalle);
router.patch('/:id/estado', [param('id').isMongoId(), body('estado').isIn(estados), validarCampos], controller.actualizar);
module.exports = router;
