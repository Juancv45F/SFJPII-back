const express = require('express');
const router = express.Router();
const { register, verifyCode, login } = require('../controllers/authController');

// Registro (Recibe Datos Personales + Ubicación + Captcha)
router.post('/register', register);

// Verificación SMS
router.post('/verify', verifyCode);

// Iniciar Sesión
router.post('/login', login);

module.exports = router;