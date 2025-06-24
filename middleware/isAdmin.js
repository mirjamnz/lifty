// middleware/isAdmin.js
module.exports = (req, res, next) => {
  if (req.session && req.session.is_admin) {
    return next();
  }

  res.status(403).render('403', {
    session: req.session,
    message: 'Admin access only. Please log in as an administrator.'
  });
};
