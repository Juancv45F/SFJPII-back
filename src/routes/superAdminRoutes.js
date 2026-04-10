const { Router } = require('express');
const { authLimiter } = require('../middlewares/security');
const { requireSuperAdmin, redirectIfLoggedIn } = require('../middlewares/superAdminSession');
const {
  renderLogin,
  handleLogin,
  logout,
  dashboard,
  usersPage,
  setRole,
  enableUser,
  suspendUser,
  disableUser,
  logsPage
} = require('../controllers/superAdminController');

const router = Router();

router.use((req, res, next) => {
  const qTheme = typeof req.query?.theme === 'string' ? req.query.theme.trim().toLowerCase() : '';
  if (qTheme === 'light' || qTheme === 'dark') {
    req.session.superAdminTheme = qTheme;
  }
  res.locals.theme = req?.session?.superAdminTheme || 'dark';
  next();
});

router.get('/login', [redirectIfLoggedIn], renderLogin);
router.post('/login', [authLimiter], handleLogin);
router.get('/logout', logout);

router.get('/', [requireSuperAdmin], dashboard);
router.get('/users', [requireSuperAdmin], usersPage);
router.post('/users/:id/role', [requireSuperAdmin], setRole);
router.post('/users/:id/enable', [requireSuperAdmin], enableUser);
router.post('/users/:id/suspend', [requireSuperAdmin], suspendUser);
router.post('/users/:id/disable', [requireSuperAdmin], disableUser);
router.get('/logs', [requireSuperAdmin], logsPage);

module.exports = router;

