// middleware.js - parehong token guard gaya ng product-service
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

// Kinu-check kung may access ang staff admin sa parteng ito
// (super_admin ay laging may buong access)
function requirePermission(key) {
  return (req, res, next) => {
    if (req.admin.role === 'super_admin') return next();
    if ((req.admin.permissions || []).includes(key)) return next();
    return res.status(403).json({ error: 'You do not have access to this section.' });
  };
}
module.exports.requirePermission = requirePermission;

// Guard na ginagamit ng mga route na para sa CUSTOMER (mobile app), hindi admin
function verifyCustomerToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Please log in first.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'customer') {
      return res.status(403).json({ error: 'Customer accounts only.' });
    }
    req.customer = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}
module.exports.verifyCustomerToken = verifyCustomerToken;