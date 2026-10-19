// server.js - Auth Service
// Ito ang API na hahawak ng LOGIN ng admin AT ng customer (mobile app).
// Tumatakbo ito sa sarili niyang "port" (http://localhost:4000)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('./db');
const { verifyToken, requireSuperAdmin, requirePermission } = require('./middleware');

const app = express();
app.set('trust proxy', 1); // Render is behind a proxy; needed to read the real client IP
app.use(cors()); // para pwedeng tumawag ang admin-web (HTML/JS) sa API na ito
app.use(express.json()); // para ma-basa natin ang JSON na ipinadala ng frontend

const JWT_SECRET = process.env.JWT_SECRET;

// -----------------------------------------------------
// Helpers: validation, email sending, verification codes
// -----------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRONG_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const PASSWORD_MESSAGE = 'Password must be at least 8 characters with uppercase and lowercase letters, a number, and a special character (e.g. !@#$%).';

const CODE_MINUTES = 10;      // how long a code stays valid
const MAX_CODE_ATTEMPTS = 5;  // wrong guesses allowed per code
const RESEND_SECONDS = 60;    // wait time before another code can be requested

const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ .'-]{0,49}$/;
const USERNAME_RE = /^[a-z0-9._]{4,20}$/;
const USERNAME_MESSAGE = 'Username must be 4-20 characters: lowercase letters, numbers, dot, or underscore (with at least one letter).';
const NAME_MESSAGE = "Names can only contain letters, spaces, and . ' - (up to 50 characters).";

function cleanName(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

function composeFullName(first, middle, last) {
  return [first, middle, last].filter(Boolean).join(' ');
}

function validUsername(name) {
  return USERNAME_RE.test(name) && /[a-z]/.test(name);
}

function isValidDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(text + 'T00:00:00Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function ageFromBirthday(text) {
  const [y, m, d] = text.split('-').map(Number);
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  const diff = now.getUTCMonth() + 1 - m || now.getUTCDate() - d;
  if (diff < 0) age -= 1;
  return age;
}

function isUsernameDuplicate(err) {
  return err.code === 'ER_DUP_ENTRY' && /uq_users_username/.test(err.sqlMessage || '');
}

function isDatabaseDown(err) {
  return ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'EAI_AGAIN'].includes(err.code);
}

// Used by the new routes below: turns known problems into clear messages
function handleError(res, err) {
  console.error(err);
  if (err.code === 'COOLDOWN') return res.status(429).json({ error: err.message, wait: err.wait });
  if (err.code === 'EMAIL_NOT_CONFIGURED') return res.status(503).json({ error: 'Email sending is not set up on the server yet.' });
  if (err.code === 'EMAIL_FAILED') return res.status(502).json({ error: 'We could not send the email right now. Please try again in a few minutes.' });
  if (isDatabaseDown(err)) return res.status(503).json({ error: 'The database is temporarily unavailable. Please try again in a moment.' });
  return res.status(500).json({ error: 'Something went wrong on the server.' });
}

function parsePermissions(value) {
  return value ? String(value).split(',').map(p => p.trim()).filter(Boolean) : [];
}

function escapeHtml(text) {
  return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A profile photo is a link (the photo itself is stored on Cloudinary)
function cleanPhotoUrl(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return { value: null };
  if (!/^https?:\/\/\S+$/i.test(v) || v.length > 500) return { error: 'The profile photo must be a valid http(s) link.' };
  return { value: v };
}

// Tiny in-memory limiter (protects the free email quota from abuse)
const hits = new Map();
function allow(key, max, windowMs) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.first > windowMs) {
    hits.set(key, { count: 1, first: now });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count += 1;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) if (now - entry.first > 3600000) hits.delete(key);
}, 600000).unref();

// Sends an email through Brevo's HTTPS API (Render's free tier blocks normal SMTP)
async function sendEmail({ to, subject, html }) {
  if (!process.env.BREVO_API_KEY || !process.env.EMAIL_FROM) {
    const err = new Error('Email sending is not configured.');
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
    body: JSON.stringify({
      sender: { name: process.env.EMAIL_FROM_NAME || 'Fitora Gear', email: process.env.EMAIL_FROM },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    console.error('Brevo rejected the email:', response.status, await response.text());
    const err = new Error('The email provider rejected the message.');
    err.code = 'EMAIL_FAILED';
    throw err;
  }
}

function codeEmailHtml(name, code) {
  return `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
    <h2 style="color:#6C5CE7;margin:0 0 12px">Fitora Gear</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>Use this code to verify your email address:</p>
    <p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#2B2140;margin:16px 0">${code}</p>
    <p style="color:#666;font-size:13px">This code expires in ${CODE_MINUTES} minutes. If you did not request it, you can ignore this email.</p>
  </div>`;
}

// Creates a 6-digit code (stored hashed) and emails it. Throws if the email cannot be sent.
async function issueVerificationCode(accountType, accountId, email, name) {
  const [recent] = await pool.query(
    'SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age FROM email_verifications WHERE account_type = ? AND account_id = ? ORDER BY verification_id DESC LIMIT 1',
    [accountType, accountId]
  );
  if (recent.length > 0 && recent[0].age < RESEND_SECONDS) {
    const wait = RESEND_SECONDS - recent[0].age;
    const err = new Error(`Please wait ${wait} seconds before requesting another code.`);
    err.code = 'COOLDOWN';
    err.wait = wait;
    throw err;
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const hash = await bcrypt.hash(code, 8);
  await pool.query('DELETE FROM email_verifications WHERE account_type = ? AND account_id = ?', [accountType, accountId]);
  await pool.query(
    'INSERT INTO email_verifications (account_type, account_id, email, code_hash, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))',
    [accountType, accountId, email, hash, CODE_MINUTES]
  );

  try {
    await sendEmail({ to: email, subject: 'Your Fitora Gear verification code', html: codeEmailHtml(name, code) });
  } catch (err) {
    // The email never left, so remove the code and let the user try again right away
    await pool.query('DELETE FROM email_verifications WHERE account_type = ? AND account_id = ?', [accountType, accountId]);
    throw err;
  }
}

// Checks a code typed by the user. Returns { ok: true } or { ok: false, status, message }.
async function checkVerificationCode(accountType, accountId, email, code) {
  const [rows] = await pool.query(
    'SELECT verification_id, code_hash, attempts, (expires_at < UTC_TIMESTAMP()) AS expired FROM email_verifications WHERE account_type = ? AND account_id = ? AND email = ? ORDER BY verification_id DESC LIMIT 1',
    [accountType, accountId, email]
  );
  if (rows.length === 0) return { ok: false, status: 400, message: 'No code found. Please request a new code.' };

  const row = rows[0];
  if (row.expired) return { ok: false, status: 400, message: 'This code has expired. Please request a new code.' };
  if (row.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, status: 429, message: 'Too many wrong attempts. Please request a new code.' };

  const matches = await bcrypt.compare(code, row.code_hash);
  if (!matches) {
    await pool.query('UPDATE email_verifications SET attempts = attempts + 1 WHERE verification_id = ?', [row.verification_id]);
    const left = MAX_CODE_ATTEMPTS - row.attempts - 1;
    return { ok: false, status: 400, message: left > 0 ? `Incorrect code. ${left} attempt(s) left.` : 'Incorrect code. Please request a new code.' };
  }

  await pool.query('DELETE FROM email_verifications WHERE account_type = ? AND account_id = ?', [accountType, accountId]);
  return { ok: true };
}

// -----------------------------------------------------
// POST /api/auth/login (ADMIN login)
// Tinatanggap: { username, password }
// Ibinabalik: { token, admin: {...} } kung tama, o error kung mali
// -----------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const [rows] = await pool.query('SELECT * FROM admins WHERE username = ?', [username]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Incorrect username or password.' });
    }

    const admin = rows[0];
    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect username or password.' });
    }

    // Gawing array ang permissions (naka-store bilang comma-separated text sa DB)
    const permissionsArray = admin.permissions
      ? admin.permissions.split(',').map(p => p.trim()).filter(Boolean)
      : [];

    const token = jwt.sign(
      { adminId: admin.admin_id, username: admin.username, role: admin.role, permissions: permissionsArray, type: 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      admin: {
        id: admin.admin_id,
        username: admin.username,
        fullName: admin.full_name,
        role: admin.role,
        permissions: permissionsArray,
        email: admin.email,
        emailVerified: !!admin.email_verified,
        profilePhoto: admin.profile_photo || null,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  }
});

// -----------------------------------------------------
// GET /api/auth/verify - i-check kung valid pa ang admin token
// -----------------------------------------------------
app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ valid: false, error: 'No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, admin: decoded });
  } catch (err) {
    res.status(401).json({ valid: false, error: 'The token is invalid or has expired.' });
  }
});

// =====================================================
// CUSTOMER AUTH (para sa mobile app - iba ito sa admin login)
// =====================================================

// POST /api/auth/customers/register - gumawa ng bagong customer account
app.post('/api/auth/customers/register', async (req, res) => {
  try {
    const body = req.body || {};
    const firstName = cleanName(body.first_name);
    const middleName = cleanName(body.middle_name);
    const lastName = cleanName(body.last_name);
    const username = String(body.username || '').trim().toLowerCase();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const phone = String(body.phone || '').replace(/[\s()-]/g, '');
    const address = String(body.address || '').trim();
    const birthday = String(body.birthday || '').trim();

    if (!firstName || !lastName || !username || !email || !password || !phone || !birthday) {
      return res.status(400).json({ error: 'First name, last name, username, email, password, phone number, and birthday are required.' });
    }
    if (!NAME_RE.test(firstName) || !NAME_RE.test(lastName) || (middleName && !NAME_RE.test(middleName))) {
      return res.status(400).json({ error: NAME_MESSAGE });
    }
    if (!validUsername(username)) return res.status(400).json({ error: USERNAME_MESSAGE });
    if (!EMAIL_RE.test(email) || email.length > 100) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (!STRONG_PASSWORD_RE.test(password)) return res.status(400).json({ error: PASSWORD_MESSAGE });
    if (!/^\+?\d{7,15}$/.test(phone)) return res.status(400).json({ error: 'Please enter a valid phone number (7-15 digits).' });
    if (address.length > 255) return res.status(400).json({ error: 'Address is too long (255 characters maximum).' });
    if (!isValidDate(birthday)) return res.status(400).json({ error: 'Birthday must be a real date in YYYY-MM-DD format.' });
    const age = ageFromBirthday(birthday);
    if (age < 13 || age > 120) return res.status(400).json({ error: 'You must be at least 13 years old to create an account.' });

    if (!allow('register|' + req.ip, 10, 3600000)) {
      return res.status(429).json({ error: 'Too many sign-ups from this connection. Please try again later.' });
    }

    const fullName = composeFullName(firstName, middleName, lastName);
    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `INSERT INTO users (full_name, first_name, middle_name, last_name, username, email, password, phone, address, birthday, email_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [fullName, firstName, middleName || null, lastName, username, email, hashedPassword, phone, address || null, birthday]
    );

    const token = jwt.sign({ userId: result.insertId, email, type: 'customer' }, JWT_SECRET, { expiresIn: '30d' });

    // Email the 6-digit code. If sending fails the account still exists and the app can ask for a new code.
    let emailSent = true;
    try {
      await issueVerificationCode('customer', result.insertId, email, firstName);
    } catch (mailErr) {
      console.error('Could not send the verification email:', mailErr.message);
      emailSent = false;
    }

    res.status(201).json({
      token,
      emailSent,
      customer: {
        id: result.insertId, fullName, firstName, middleName: middleName || null, lastName, username, email,
        emailVerified: false, phone, address: address || null, birthday, profilePhoto: null,
      },
    });
  } catch (err) {
    if (isUsernameDuplicate(err)) return res.status(400).json({ error: 'This username is already taken.' });
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'An account with this email already exists.' });
    handleError(res, err);
  }
});
// POST /api/auth/customers/login
app.post('/api/auth/customers/login', async (req, res) => {
  try {
    const body = req.body || {};
    const identifier = String(body.identifier || body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email or username and password are required.' });
    }
    if (!allow('login|' + req.ip + '|' + identifier, 10, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many login attempts. Please wait 15 minutes and try again.' });
    }

    // An "@" means it is an email; usernames can never contain "@"
    const column = identifier.includes('@') ? 'email' : 'username';
    const [rows] = await pool.query(
      `SELECT user_id, full_name, first_name, middle_name, last_name, username, email, password, phone, address,
              profile_photo, is_active, email_verified, DATE_FORMAT(birthday, '%Y-%m-%d') AS birthday
       FROM users WHERE ${column} = ?`,
      [identifier]
    );
    const user = rows[0];
    const matches = user ? await bcrypt.compare(password, user.password) : false;

    if (!matches) {
      return res.status(401).json({ error: 'Incorrect email/username or password.' });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'Your account has been deactivated. Please contact support.' });
    }

    const token = jwt.sign({ userId: user.user_id, email: user.email, type: 'customer' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      customer: {
        id: user.user_id, fullName: user.full_name, firstName: user.first_name, middleName: user.middle_name,
        lastName: user.last_name, username: user.username, email: user.email, emailVerified: !!user.email_verified,
        phone: user.phone, address: user.address, birthday: user.birthday, profilePhoto: user.profile_photo || null,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// Live check used by the sign-up screen
app.get('/api/auth/customers/username-available', async (req, res) => {
  try {
    const username = String(req.query.username || '').trim().toLowerCase();
    if (!validUsername(username)) return res.json({ available: false, reason: 'invalid' });
    if (!allow('uname|' + req.ip, 60, 3600000)) return res.status(429).json({ error: 'Too many checks. Please try again later.' });
    const [rows] = await pool.query('SELECT 1 FROM users WHERE username = ? LIMIT 1', [username]);
    res.json({ available: rows.length === 0 });
  } catch (err) {
    handleError(res, err);
  }
});
// BAGO: guard para sa customer-only routes (ginagamit lang dito sa auth-service)
async function verifyCustomerToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Please log in first.' });
  }
  let decoded;
  try {
    decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
  if (decoded.type !== 'customer') {
    return res.status(403).json({ error: 'Customer accounts only.' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT user_id, full_name, email, email_verified, is_active FROM users WHERE user_id = ?',
      [decoded.userId]
    );
    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({ error: 'This account is no longer available. Please log in again.' });
    }
    req.customer = {
      userId: rows[0].user_id, fullName: rows[0].full_name, email: rows[0].email,
      emailVerified: !!rows[0].email_verified, type: 'customer',
    };
    next();
  } catch (err) {
    return handleError(res, err);
  }
}

function customerProfile(u) {
  return {
    id: u.user_id, fullName: u.full_name, firstName: u.first_name, middleName: u.middle_name, lastName: u.last_name,
    username: u.username, email: u.email, emailVerified: !!u.email_verified,
    phone: u.phone, address: u.address, birthday: u.birthday, profilePhoto: u.profile_photo || null,
    createdAt: u.created_at, orderCount: Number(u.order_count || 0),
  };
}
// GET /api/auth/customers/me - the logged-in customer's full profile
app.get('/api/auth/customers/me', verifyCustomerToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.user_id, u.full_name, u.email, u.email_verified, u.first_name, u.middle_name, u.last_name, u.username, u.phone, u.address, u.profile_photo, u.created_at,
              DATE_FORMAT(u.birthday, '%Y-%m-%d') AS birthday,
              (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.user_id) AS order_count
       FROM users u WHERE u.user_id = ?`,
      [req.customer.userId]
    );
    res.json(customerProfile(rows[0]));
  } catch (err) {
    handleError(res, err);
  }
});

// PUT /api/auth/customers/me - update name, phone, address and (optionally) the profile photo
app.put('/api/auth/customers/me', verifyCustomerToken, async (req, res) => {
  try {
    const body = req.body || {};
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
    const fields = [];
    const values = [];
    const customer = {};

    // Name: first/middle/last (or the old single "full_name")
    let first = '', middle = '', last = '';
    if (has('first_name') || has('last_name')) {
      first = cleanName(body.first_name);
      middle = cleanName(body.middle_name);
      last = cleanName(body.last_name);
      if (!first || !last) return res.status(400).json({ error: 'First name and last name are required.' });
    } else if (has('full_name')) {
      const parts = cleanName(body.full_name).split(' ');
      first = parts[0] || '';
      last = parts.slice(1).join(' ');
      if (!first) return res.status(400).json({ error: 'Full name is required.' });
    }
    if (first) {
      if (!NAME_RE.test(first) || (last && !NAME_RE.test(last)) || (middle && !NAME_RE.test(middle))) {
        return res.status(400).json({ error: NAME_MESSAGE });
      }
      const fullName = composeFullName(first, middle, last);
      fields.push('full_name = ?', 'first_name = ?', 'middle_name = ?', 'last_name = ?');
      values.push(fullName, first, middle || null, last);
      Object.assign(customer, { fullName, firstName: first, middleName: middle || null, lastName: last });
    }

    if (has('username') && String(body.username).trim() !== '') {
      const username = String(body.username).trim().toLowerCase();
      if (!validUsername(username)) return res.status(400).json({ error: USERNAME_MESSAGE });
      fields.push('username = ?');
      values.push(username);
      customer.username = username;
    }
    if (has('phone')) {
      const phone = String(body.phone || '').replace(/[\s()-]/g, '');
      if (phone && !/^\+?\d{7,15}$/.test(phone)) return res.status(400).json({ error: 'Please enter a valid phone number (7-15 digits).' });
      fields.push('phone = ?');
      values.push(phone || null);
      customer.phone = phone || null;
    }
    if (has('address')) {
      const address = String(body.address || '').trim();
      if (address.length > 255) return res.status(400).json({ error: 'Address is too long (255 characters maximum).' });
      fields.push('address = ?');
      values.push(address || null);
      customer.address = address || null;
    }
    if (has('profile_photo')) {
      const photo = cleanPhotoUrl(body.profile_photo);
      if (photo.error) return res.status(400).json({ error: photo.error });
      fields.push('profile_photo = ?');
      values.push(photo.value);
      customer.profilePhoto = photo.value;
    }

    if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

    values.push(req.customer.userId);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE user_id = ?`, values);
    res.json({ message: 'Profile updated.', customer });
  } catch (err) {
    if (isUsernameDuplicate(err)) return res.status(400).json({ error: 'This username is already taken.' });
    handleError(res, err);
  }
});
// POST /api/auth/customers/me/send-code - email a new 6-digit code
app.post('/api/auth/customers/me/send-code', verifyCustomerToken, async (req, res) => {
  try {
    if (req.customer.emailVerified) return res.status(400).json({ error: 'Your email is already verified.' });
    if (!allow('send|customer|' + req.customer.userId, 6, 3600000)) {
      return res.status(429).json({ error: 'Too many code requests. Please try again in an hour.' });
    }
    await issueVerificationCode('customer', req.customer.userId, req.customer.email, req.customer.fullName);
    res.json({ message: `We sent a 6-digit code to ${req.customer.email}.`, email: req.customer.email });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/auth/customers/me/verify-code - confirm the code
app.post('/api/auth/customers/me/verify-code', verifyCustomerToken, async (req, res) => {
  try {
    const code = String((req.body || {}).code || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Please enter the 6-digit code.' });

    const result = await checkVerificationCode('customer', req.customer.userId, req.customer.email, code);
    if (!result.ok) return res.status(result.status).json({ error: result.message });

    await pool.query('UPDATE users SET email_verified = 1 WHERE user_id = ?', [req.customer.userId]);
    res.json({ message: 'Your email is verified.', emailVerified: true });
  } catch (err) {
    handleError(res, err);
  }
});

// PUT /api/auth/customers/me/password
app.put('/api/auth/customers/me/password', verifyCustomerToken, async (req, res) => {
  try {
    const currentPassword = String((req.body || {}).current_password || '');
    const newPassword = String((req.body || {}).new_password || '');
    if (!STRONG_PASSWORD_RE.test(newPassword)) return res.status(400).json({ error: PASSWORD_MESSAGE });

    const [rows] = await pool.query('SELECT password FROM users WHERE user_id = ?', [req.customer.userId]);
    if (!(await bcrypt.compare(currentPassword, rows[0].password))) {
      return res.status(400).json({ error: 'Your current password is incorrect.' });
    }
    await pool.query('UPDATE users SET password = ? WHERE user_id = ?', [await bcrypt.hash(newPassword, 10), req.customer.userId]);
    res.json({ message: 'Password changed.' });
  } catch (err) {
    handleError(res, err);
  }
});

// =====================================================
// CUSTOMER MANAGEMENT (ginagamit ng ADMIN panel)
// (mga customer na naka-register para sa mobile app/customer site)
// =====================================================

// GET /api/auth/customers - listahan ng lahat ng customers kasama ang bilang ng orders nila
app.get('/api/auth/customers', verifyToken, requirePermission('customers'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.user_id, u.full_name, u.username, u.email, u.phone, u.address, u.is_active, u.email_verified, u.created_at,
             COUNT(o.order_id) AS order_count
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.user_id
      GROUP BY u.user_id
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// PUT /api/auth/customers/:id/status - i-activate o i-deactivate ang isang customer account
app.put('/api/auth/customers/:id/status', verifyToken, requirePermission('customers'), async (req, res) => {
  try {
    const { is_active } = req.body;
    await pool.query('UPDATE users SET is_active = ? WHERE user_id = ?', [is_active ? 1 : 0, req.params.id]);
    res.json({ message: 'Customer status updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// =====================================================
// ADMIN MANAGEMENT
// (para sa mga miyembro ng grupo na kailangan din ng sariling admin login)
// =====================================================

// =====================================================
// ADMIN PROFILE (the logged-in admin)
// =====================================================
function adminProfile(r) {
  return {
    id: r.admin_id, username: r.username, fullName: r.full_name, email: r.email,
    emailVerified: !!r.email_verified, role: r.role, permissions: parsePermissions(r.permissions),
    profilePhoto: r.profile_photo || null, createdAt: r.created_at,
  };
}

async function loadAdmin(adminId) {
  const [rows] = await pool.query(
    'SELECT admin_id, username, full_name, email, email_verified, role, permissions, profile_photo, created_at FROM admins WHERE admin_id = ?',
    [adminId]
  );
  return rows[0];
}

app.get('/api/auth/admins/me', verifyToken, async (req, res) => {
  try {
    const admin = await loadAdmin(req.admin.adminId);
    if (!admin) return res.status(404).json({ error: 'Admin not found.' });
    res.json(adminProfile(admin));
  } catch (err) {
    handleError(res, err);
  }
});

// Changing the email marks it as "not verified" until the new code is confirmed
app.put('/api/auth/admins/me', verifyToken, async (req, res) => {
  try {
    const body = req.body || {};
    const fullName = String(body.full_name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();

    if (fullName.length < 2 || fullName.length > 100) {
      return res.status(400).json({ error: 'Full name must be 2-100 characters.' });
    }
    if (email && (!EMAIL_RE.test(email) || email.length > 100)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const current = await loadAdmin(req.admin.adminId);
    if (!current) return res.status(404).json({ error: 'Admin not found.' });

    let photo = current.profile_photo;
    if (body.profile_photo !== undefined) {
      const cleaned = cleanPhotoUrl(body.profile_photo);
      if (cleaned.error) return res.status(400).json({ error: cleaned.error });
      photo = cleaned.value;
    }

    const currentEmail = current.email ? String(current.email).toLowerCase() : null;
    const emailChanged = (email || null) !== currentEmail;
    const verified = emailChanged ? 0 : (current.email_verified ? 1 : 0);

    await pool.query('UPDATE admins SET full_name = ?, email = ?, profile_photo = ?, email_verified = ? WHERE admin_id = ?', [
      fullName, email || null, photo, verified, req.admin.adminId,
    ]);
    res.json({ message: 'Profile updated.', emailChanged, admin: adminProfile(await loadAdmin(req.admin.adminId)) });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/auth/admins/me/send-code', verifyToken, async (req, res) => {
  try {
    const admin = await loadAdmin(req.admin.adminId);
    if (!admin) return res.status(404).json({ error: 'Admin not found.' });
    if (!admin.email) return res.status(400).json({ error: 'Add an email address to your profile first.' });
    if (admin.email_verified) return res.status(400).json({ error: 'Your email is already verified.' });
    if (!allow('send|admin|' + admin.admin_id, 6, 3600000)) {
      return res.status(429).json({ error: 'Too many code requests. Please try again in an hour.' });
    }
    await issueVerificationCode('admin', admin.admin_id, admin.email, admin.full_name);
    res.json({ message: `We sent a 6-digit code to ${admin.email}.`, email: admin.email });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/auth/admins/me/verify-code', verifyToken, async (req, res) => {
  try {
    const code = String((req.body || {}).code || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Please enter the 6-digit code.' });

    const admin = await loadAdmin(req.admin.adminId);
    if (!admin || !admin.email) return res.status(400).json({ error: 'Add an email address to your profile first.' });

    const result = await checkVerificationCode('admin', admin.admin_id, admin.email, code);
    if (!result.ok) return res.status(result.status).json({ error: result.message });

    await pool.query('UPDATE admins SET email_verified = 1 WHERE admin_id = ?', [admin.admin_id]);
    res.json({ message: 'Your email is verified.', emailVerified: true });
  } catch (err) {
    handleError(res, err);
  }
});

app.put('/api/auth/admins/me/password', verifyToken, async (req, res) => {
  try {
    const currentPassword = String((req.body || {}).current_password || '');
    const newPassword = String((req.body || {}).new_password || '');
    if (!STRONG_PASSWORD_RE.test(newPassword)) return res.status(400).json({ error: PASSWORD_MESSAGE });

    const [rows] = await pool.query('SELECT password FROM admins WHERE admin_id = ?', [req.admin.adminId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Admin not found.' });
    if (!(await bcrypt.compare(currentPassword, rows[0].password))) {
      return res.status(400).json({ error: 'Your current password is incorrect.' });
    }
    await pool.query('UPDATE admins SET password = ? WHERE admin_id = ?', [await bcrypt.hash(newPassword, 10), req.admin.adminId]);
    res.json({ message: 'Password changed.' });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/auth/admins - listahan ng lahat ng admin accounts (walang kasamang password)
// Super Admin lang ang makakakita nito
app.get('/api/auth/admins', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT admin_id, username, full_name, email, email_verified, profile_photo, role, permissions, created_at FROM admins ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// POST /api/auth/admins - gumawa ng bagong admin account
app.post('/api/auth/admins', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, full_name, email, role, permissions } = req.body;

    if (!username || !password || !full_name) {
      return res.status(400).json({ error: 'Username, password, and full name are required.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const finalRole = role === 'super_admin' ? 'super_admin' : 'staff';
    const permissionsStr = Array.isArray(permissions) ? permissions.join(',') : null;

    const [result] = await pool.query(
      'INSERT INTO admins (username, password, full_name, email, role, permissions) VALUES (?, ?, ?, ?, ?, ?)',
      [username, hashedPassword, full_name, email || null, finalRole, permissionsStr]
    );

    res.status(201).json({ admin_id: result.insertId, username, full_name, email, role: finalRole, permissions });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'This username is already taken.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// DELETE /api/auth/admins/:id - tanggalin ang isang admin account
app.delete('/api/auth/admins/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.admin.adminId) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    await pool.query('DELETE FROM admins WHERE admin_id = ?', [req.params.id]);
    res.json({ message: 'Admin account deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});