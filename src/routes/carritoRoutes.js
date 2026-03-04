const { Router } = require('express');
const { validateToken } = require('../middlewares/validateToken');
const { getCarrito, syncCarrito, removeItem, addItem } = require('../controllers/carritoController');

const router = Router();

router.get('/', [validateToken], getCarrito);
router.post('/sync', [validateToken], syncCarrito);
router.post('/:id', [validateToken], addItem);
router.delete('/:id', [validateToken], removeItem);

module.exports = router;
