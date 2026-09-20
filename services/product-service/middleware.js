// middleware.js
// Ito ang "guard" na siniguraduhin na naka-login (may valid token) bago
// makapag-add/edit/delete ng products. Ginagamit ito sa server.js.

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
    if (decoded.type !== 'admin') {
      return res.status(403).json({ error: 'Admin account lang ang pwedeng gumamit nito.' });
    }
    req.admin = decoded; // pwede nating gamitin ito sa susunod na functions
    next(); // tuloy na sa actual na route
  } catch (err) {
    return res.status(401).json({ error: 'Expired o invalid na ang session mo.' });
  }
}

// Kinu-check kung may access ang staff admin sa parteng ito
// (super_admin ay laging may buong access)
function requirePermission(key) {
  return (req, res, next) => {
    if (req.admin.role === 'super_admin') return next();
    if ((req.admin.permissions || []).includes(key)) return next();
    return res.status(403).json({ error: 'Wala kang access sa parteng ito.' });
  };
}

// BAGO: guard na ginagamit ng mga route na para sa CUSTOMER (mobile app),
// hindi admin - kailangan ito para makapag-submit ng review ang customer.
function verifyCustomerToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Kailangan mag-login muna.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'customer') {
      return res.status(403).json({ error: 'Customer account lang ang pwedeng gumamit nito.' });
    }
    req.customer = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Expired o invalid na ang session mo.' });
  }
}

module.exports = { verifyToken, requirePermission, verifyCustomerToken };