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
  getRecoveryQuestionsStatus
} = require('../controllers/userController');

const router = Router();

router.get('/me', [validateToken], getMe);
router.put('/:id/role', [validateToken, authorizeRoles('admin')], updateUserRole);
router.put('/password', [validateToken], changePassword);
router.put('/mfa', [validateToken], updateMfa);

// Preguntas de seguridad
router.get('/recovery/questions', [validateToken], getRecoveryQuestionsStatus);
router.put('/recovery/questions', [validateToken], updateRecoveryQuestions);

router.get('/preferences', [validateToken], getPreferences);
router.put('/preferences', [validateToken], updatePreferences);

router.get('/sessions', [validateToken], listSessions);
router.post('/sessions/revoke', [validateToken], revokeSession);
router.post('/sessions/revoke-others', [validateToken], revokeOtherSessions);

module.exports = router;
