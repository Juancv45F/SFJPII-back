const { Router } = require('express');
const { validateToken, authorizeRoles } = require('../middlewares/validateToken');
const {
  getMe,
  deleteOwnAccount,
  updateProfile,
  changePassword,
  updateMfa,
  getPreferences,
  updatePreferences,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  updateUserRole,
  updateRecoveryQuestions,
  getRecoveryQuestionsStatus,
  beginTotpSetup,
  verifyTotpSetup,
  resetTotpStart,
  resetTotpVerify,
  upsertPushToken,
  removePushToken
} = require('../controllers/userController');

const router = Router();

router.get('/me', [validateToken], getMe);
router.delete('/account', [validateToken], deleteOwnAccount);
router.put('/profile', [validateToken], updateProfile);
router.put('/:id/role', [validateToken, authorizeRoles('admin', 'super_admin')], updateUserRole);
router.put('/password', [validateToken], changePassword);
router.put('/mfa', [validateToken], updateMfa);
router.post('/mfa/totp/setup', [validateToken], beginTotpSetup);
router.post('/mfa/totp/verify', [validateToken], verifyTotpSetup);
router.post('/mfa/totp/reset/start', [validateToken], resetTotpStart);
router.post('/mfa/totp/reset/verify', [validateToken], resetTotpVerify);

// Preguntas de seguridad
router.get('/recovery/questions', [validateToken], getRecoveryQuestionsStatus);
router.put('/recovery/questions', [validateToken], updateRecoveryQuestions);

// Preferencias del usuario
router.get('/preferences', [validateToken], getPreferences);
router.put('/preferences', [validateToken], updatePreferences);

// Siones del usuario actual
router.get('/sessions', [validateToken], listSessions);
router.post('/sessions/revoke', [validateToken], revokeSession);
router.post('/sessions/revoke-others', [validateToken], revokeOtherSessions);

// Push tokens
router.put('/push-token', [validateToken], upsertPushToken);
router.delete('/push-token', [validateToken], removePushToken);

module.exports = router;
