const { Router } = require('express');
const { validateToken } = require('../middlewares/validateToken');
const {
  getMe,
  changePassword,
  updateMfa,
  getPreferences,
  updatePreferences,
  listSessions,
  revokeSession,
  revokeOtherSessions
} = require('../controllers/userController');

const router = Router();

router.get('/me', [validateToken], getMe);
router.put('/password', [validateToken], changePassword);
router.put('/mfa', [validateToken], updateMfa);

router.get('/preferences', [validateToken], getPreferences);
router.put('/preferences', [validateToken], updatePreferences);

router.get('/sessions', [validateToken], listSessions);
router.post('/sessions/revoke', [validateToken], revokeSession);
router.post('/sessions/revoke-others', [validateToken], revokeOtherSessions);

module.exports = router;
