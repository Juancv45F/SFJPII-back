const User = require('../models-mongo/user');

function normalizeStatus(user) {
  const status = String(user?.access?.status || 'active').toLowerCase();
  const suspendedUntil = user?.access?.suspendedUntil ? new Date(user.access.suspendedUntil) : null;
  const disabledAt = user?.access?.disabledAt ? new Date(user.access.disabledAt) : null;
  return { status, suspendedUntil, disabledAt };
}

async function requireSuperAdmin(req, res, next) {
  try {
    const uid = req?.session?.superAdminUserId ? String(req.session.superAdminUserId) : '';
    if (!uid) return res.redirect('/superadmin/login');

    const user = await User.findById(uid).select('nombre apellido email role access').exec();
    if (!user || String(user.role) !== 'super_admin') {
      try { req.session.destroy(() => {}); } catch {}
      return res.redirect('/superadmin/login');
    }

    const { status, suspendedUntil, disabledAt } = normalizeStatus(user);
    if (status === 'disabled' || disabledAt) {
      try { req.session.destroy(() => {}); } catch {}
      return res.status(403).send('Cuenta de super admin deshabilitada');
    }
    if (status === 'suspended' && suspendedUntil && suspendedUntil.getTime() > Date.now()) {
      try { req.session.destroy(() => {}); } catch {}
      return res.status(403).send('Cuenta de super admin suspendida temporalmente');
    }

    req.superAdmin = user;
    res.locals.superAdmin = {
      id: String(user._id),
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email
    };
    return next();
  } catch {
    return res.redirect('/superadmin/login');
  }
}

function redirectIfLoggedIn(req, res, next) {
  const uid = req?.session?.superAdminUserId ? String(req.session.superAdminUserId) : '';
  if (uid) return res.redirect('/superadmin');
  return next();
}

module.exports = {
  requireSuperAdmin,
  redirectIfLoggedIn
};

