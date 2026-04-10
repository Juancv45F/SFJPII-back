const { Router } = require('express');
const { validateToken, authorizeRoles } = require('../middlewares/validateToken');
const { getCarrito, syncCarrito, removeItem, addItem } = require('../controllers/carritoController');

const router = Router();

router.get('/', [validateToken, authorizeRoles('cliente')], getCarrito);
router.post('/sync', [validateToken, authorizeRoles('cliente')], syncCarrito);
router.post('/:id', [validateToken, authorizeRoles('cliente')], addItem);
router.delete('/:id', [validateToken, authorizeRoles('cliente')], removeItem);

module.exports = router;
