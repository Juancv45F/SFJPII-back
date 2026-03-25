const { Router } = require('express');
const { validateToken, authorizeRoles } = require('../middlewares/validateToken');
const {
  getMe,
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
  upsertPushToken,
  removePushToken
} = require('../controllers/userController');

const router = Router();

router.get('/me', [validateToken], getMe);
router.put('/:id/role', [validateToken, authorizeRoles('admin')], updateUserRole);
router.put('/password', [validateToken], changePassword);
router.put('/mfa', [validateToken], updateMfa);
router.post('/mfa/totp/setup', [validateToken], beginTotpSetup);
router.post('/mfa/totp/verify', [validateToken], verifyTotpSetup);

// Preguntas de seguridad
router.get('/recovery/questions', [validateToken], getRecoveryQuestionsStatus);
router.put('/recovery/questions', [validateToken], updateRecoveryQuestions);

router.get('/preferences', [validateToken], getPreferences);
router.put('/preferences', [validateToken], updatePreferences);

router.get('/sessions', [validateToken], listSessions);
router.post('/sessions/revoke', [validateToken], revokeSession);
router.post('/sessions/revoke-others', [validateToken], revokeOtherSessions);

// Push tokens
router.put('/push-token', [validateToken], upsertPushToken);
router.delete('/push-token', [validateToken], removePushToken);

module.exports = router;
