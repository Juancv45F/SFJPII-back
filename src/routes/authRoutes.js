const express = require('express');
const router = express.Router();
const { register, verifyCode, resendVerifyCode, login, resendMfaOtp, verifyMfa, refresh, generateSsoToken, validateSsoToken } = require('../controllers/authController');
const { validateToken } = require('../middlewares/validateToken');

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

// --- SSO ---
router.get('/sso/token', [validateToken], generateSsoToken);
router.post('/sso/validate', validateSsoToken);

// --- Recuperación de Contraseña ---
router.post('/recovery/request', requestPasswordRecovery);
router.post('/recovery/verify', verifyRecoveryStep);
router.post('/recovery/reset', resetPassword);

module.exports = router;
