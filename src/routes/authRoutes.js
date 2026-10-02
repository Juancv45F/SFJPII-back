const express = require('express');
const router = express.Router();
const { register, verifyCode, resendVerifyCode, login, googleLogin, resendMfaOtp, verifyMfa, refresh, logoutApi, generateSsoToken, validateSsoToken, webauthnBeginRegistration, webauthnFinishRegistration, webauthnBeginLogin, webauthnFinishLogin, webauthnListCredentials, webauthnRenameCredential, webauthnDeleteCredentials, requestPasswordRecovery, verifyRecoveryStep, resetPassword } = require('../controllers/authController');
const { validateToken } = require('../middlewares/validateToken');
const { authLimiter } = require('../middlewares/security');

// Registro (Recibe Datos Personales + Ubicación + Captcha)
router.post('/register', [authLimiter], register);

// Verificación code
router.post('/verify', verifyCode);

router.post('/verify/resend', resendVerifyCode);

// Iniciar Sesión
router.post('/login', [authLimiter], login);
router.post('/google', [authLimiter], googleLogin);

// --- Passkeys (WebAuthn) ---
router.post('/webauthn/register/options', [validateToken], webauthnBeginRegistration);
router.post('/webauthn/register/verify', [validateToken], webauthnFinishRegistration);
router.post('/webauthn/login/options', [authLimiter], webauthnBeginLogin);
router.post('/webauthn/login/verify', [authLimiter], webauthnFinishLogin);
router.get('/webauthn/credentials', [validateToken], webauthnListCredentials);
router.patch('/webauthn/credentials', [validateToken], webauthnRenameCredential);
router.delete('/webauthn/credentials', [validateToken], webauthnDeleteCredentials);

router.post('/mfa/resend', resendMfaOtp);

router.post('/mfa/verify', verifyMfa);

router.post('/refresh', refresh);

router.post('/logout', logoutApi);

// --- SSO ---
router.get('/sso/token', [validateToken], generateSsoToken);
router.post('/sso/validate', validateSsoToken);

// --- Recuperación de Contraseña ---
router.post('/recovery/request', requestPasswordRecovery);
router.post('/recovery/verify', verifyRecoveryStep);
router.post('/recovery/reset', resetPassword);

module.exports = router;
