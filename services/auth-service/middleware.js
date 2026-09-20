// middleware.js - parehong token guard gaya ng ibang services
const jwt = require('jsonwebtoken');
require('dotenv').config();

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Kailangan mag-login muna.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Siguraduhin na admin token talaga ito, hindi customer token
    // (parehong JWT_SECRET ang ginagamit ng buong system, kaya kailangan
    // itong i-check para hindi magamit ng customer account ang admin routes)
    if (decoded.type !== 'admin') {
      return res.status(403).json({ error: 'Admin account lang ang pwedeng gumamit nito.' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Expired o invalid na ang session mo.' });
  }
}

module.exports = { verifyToken };

// Ginagamit lang ito ng mga route na dapat Super Admin lang ang makagawa
// (hal. pag-add/delete ng ibang admin account)
function requireSuperAdmin(req, res, next) {
  if (req.admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super Admin lang ang may access dito.' });
  }
  next();
}

// Ginagamit para sa mga route na dapat naka-based sa "permissions" ng isang staff admin
// (hal. kung wala silang "customers" sa permissions nila, hindi sila makaka-access)
function requirePermission(key) {
  return (req, res, next) => {
    if (req.admin.role === 'super_admin') return next(); // buong access
    if ((req.admin.permissions || []).includes(key)) return next();
    return res.status(403).json({ error: 'Wala kang access sa parteng ito.' });
  };
}

module.exports.requireSuperAdmin = requireSuperAdmin;
module.exports.requirePermission = requirePermission;