// middleware.js - parehong token guard gaya ng ibang services
const jwt = require('jsonwebtoken');
require('dotenv').config();

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Please log in first.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Siguraduhin na admin token talaga ito, hindi customer token
    // (parehong JWT_SECRET ang ginagamit ng buong system, kaya kailangan
    // itong i-check para hindi magamit ng customer account ang admin routes)
    if (decoded.type !== 'admin') {
      return res.status(403).json({ error: 'Admin accounts only.' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}

module.exports = { verifyToken };

// Ginagamit lang ito ng mga route na dapat Super Admin lang ang makagawa
// (hal. pag-add/delete ng ibang admin account)
function requireSuperAdmin(req, res, next) {
  if (req.admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a Super Admin can do this.' });
  }
  next();
}

// Ginagamit para sa mga route na dapat naka-based sa "permissions" ng isang staff admin
// (hal. kung wala silang "customers" sa permissions nila, hindi sila makaka-access)
function requirePermission(key) {
  return (req, res, next) => {
    if (req.admin.role === 'super_admin') return next(); // buong access
    if ((req.admin.permissions || []).includes(key)) return next();
    return res.status(403).json({ error: 'You do not have access to this section.' });
  };
}

module.exports.requireSuperAdmin = requireSuperAdmin;
module.exports.requirePermission = requirePermission;