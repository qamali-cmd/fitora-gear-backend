// middleware.js
// Ito ang "guard" na siniguraduhin na naka-login (may valid token) bago
// makapag-add/edit/delete ng products. Ginagamit ito sa server.js.

const jwt = require('jsonwebtoken');
require('dotenv').config();
const pool = require('./db');

// Checks the admin token AND the admin account in the database every time, so a deleted admin
// is stopped at once, and a changed role or permissions work at once (not after the next login)
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Please log in first.' });
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
  // Siguraduhin na admin token talaga ito, hindi customer token
  // (parehong JWT_SECRET ang ginagamit ng buong system, kaya kailangan itong i-check)
  if (decoded.type !== 'admin') {
    return res.status(403).json({ error: 'Admin accounts only.' });
  }

  try {
    let rows;
    try {
      [rows] = await pool.query(
        'SELECT admin_id, username, full_name, role, permissions, is_active, last_seen_at, sessions_valid_after FROM admins WHERE admin_id = ?',
        [decoded.adminId]
      );
    } catch (err) {
      if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
      // the database was not updated yet (the new columns are missing): the older check is used until it is
      [rows] = await pool.query('SELECT admin_id, username, full_name, role, permissions FROM admins WHERE admin_id = ?', [decoded.adminId]);
    }
    if (rows.length === 0) {
      return res.status(401).json({ error: 'This admin account no longer exists. Please log in again.' });
    }
    const admin = rows[0];

    // The Super Admin can deactivate an account, or log an admin out. Both stop the admin at once.
    if (admin.is_active === 0 || admin.is_active === false) {
      return res.status(401).json({ error: 'This admin account was deactivated. Please contact the Super Admin.', code: 'ADMIN_INACTIVE' });
    }
    if (admin.sessions_valid_after && decoded.iat * 1000 < new Date(admin.sessions_valid_after).getTime()) {
      return res.status(401).json({ error: 'The Super Admin logged you out. Please log in again.', code: 'LOGGED_OUT' });
    }

    // "Online": write down that this admin is active now (at most once a minute, and it never stops the request)
    const now = Date.now();
    if (admin.last_seen_at !== undefined && (!admin.last_seen_at || now - new Date(admin.last_seen_at).getTime() > 60000)) {
      Promise.resolve(pool.query('UPDATE admins SET last_seen_at = ? WHERE admin_id = ?', [new Date(now), admin.admin_id])).catch(() => {});
    }

    req.admin = {
      ...decoded,
      username: admin.username,
      fullName: admin.full_name,
      role: admin.role,
      permissions: admin.permissions ? String(admin.permissions).split(',').map((p) => p.trim()).filter(Boolean) : [],
    };
    return next();
  } catch (err) {
    console.error(err);
    return res.status(503).json({ error: 'We could not check your account right now. Please try again.' });
  }
}

// Kinu-check kung may access ang staff admin sa parteng ito
// (super_admin ay laging may buong access)
function requirePermission(key) {
  return (req, res, next) => {
    if (req.admin.role === 'super_admin') return next();
    if ((req.admin.permissions || []).includes(key)) return next();
    return res.status(403).json({ error: 'You do not have access to this section.' });
  };
}

// BAGO: guard na ginagamit ng mga route na para sa CUSTOMER (mobile app),
// hindi admin - kailangan ito para makapag-submit ng review ang customer.
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

module.exports = { verifyToken, requirePermission, verifyCustomerToken };