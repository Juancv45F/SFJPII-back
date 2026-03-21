const express = require('express');
const router = express.Router();
const { register, verifyCode, resendVerifyCode, login, resendMfaOtp, verifyMfa, refresh } = require('../controllers/authController');

// Registro (Recibe Datos Personales + Ubicación + Captcha)
router.post('/register', register);

// Verificación SMS
router.post('/verify', verifyCode);

router.post('/verify/resend', resendVerifyCode);

// Iniciar Sesión
router.post('/login', login);

router.post('/mfa/resend', resendMfaOtp);

router.post('/mfa/verify', verifyMfa);

router.post('/refresh', refresh);

module.exports = router;
