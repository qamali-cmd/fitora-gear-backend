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

function codeEmailHtml(name, code, intro) {
  return `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
    <h2 style="color:#FC408C;margin:0 0 12px">Fitora Gear</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>${escapeHtml(intro || 'Use this code to verify your email address:')}</p>
    <p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#2B2140;margin:16px 0">${code}</p>
    <p style="color:#666;font-size:13px">This code expires in ${CODE_MINUTES} minutes. If you did not request it, you can ignore this email.</p>
  </div>`;
}

// Creates a 6-digit code (stored hashed) and emails it. Throws if the email cannot be sent.
async function issueVerificationCode(accountType, accountId, email, name, purpose) {
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
    await sendEmail({ to: email, subject: (purpose && purpose.subject) || 'Your Fitora Gear verification code', html: codeEmailHtml(name, code, purpose && purpose.intro) });
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
// =====================================================
// ACTIVITY LOG: writes down what an admin did, AFTER it worked.
// It never stops or changes the action: if writing fails, the action is still done.
// =====================================================
async function logActivity(admin, action, description, entityType, entityId) {
  try {
    await pool.query(
      'INSERT INTO admin_activity (admin_id, admin_name, action, description, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [admin.adminId || null, String(admin.fullName || admin.username || 'Admin').slice(0, 100), action, String(description).slice(0, 300), entityType || null, entityId || null, new Date()]
    );
  } catch (err) {
    console.warn('The activity was not written down:', err.message);
  }
}

// Put it in a route after the permission check:  track('product.delete', { lookup, describe, entity })
//   action   = a text, or a function (req, before, body) that gives the text
//   lookup   = reads what is needed BEFORE the action (for example the name of something about to be deleted)
//   describe = the sentence (return nothing to write nothing)
//   entity   = [type, id] of what was changed
function track(action, { lookup, describe, entity }) {
  return async (req, res, next) => {
    let before = null;
    if (lookup) { try { before = await lookup(req); } catch (err) { before = null; } }
    const send = res.json.bind(res);
    res.json = (body) => {
      const out = send(body);
      const status = res.statusCode || res.code || 200;
      if (status < 400) {
        Promise.resolve()
          .then(async () => {
            const text = await describe(req, before, body || {});
            if (!text) return;
            const name = typeof action === 'function' ? action(req, before, body || {}) : action;
            const [entityType, entityId] = entity ? entity(req, before, body || {}) : [];
            await logActivity(req.admin, name, text, entityType, entityId);
          })
          .catch((err) => console.warn('The activity was not written down:', err.message));
      }
      return out;
    };
    return next();
  };
}

const lookupCustomerName = async (req) => { const [r] = await pool.query('SELECT full_name FROM users WHERE user_id = ?', [Number(req.params.id)]); return r[0] ? r[0].full_name : null; };
const lookupAdminName = async (req) => { const [r] = await pool.query('SELECT full_name FROM admins WHERE admin_id = ?', [Number(req.params.id)]); return r[0] ? r[0].full_name : null; };

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

    // A deactivated account cannot log in (this is checked AFTER the password, so a stranger learns nothing)
    if (admin.is_active === 0 || admin.is_active === false) {
      return res.status(403).json({ error: 'This admin account was deactivated. Please contact the Super Admin.', code: 'ADMIN_INACTIVE' });
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

    // write down the login (this never stops the login; it fails quietly if the database was not updated yet)
    const loginTime = new Date();
    Promise.resolve(pool.query('UPDATE admins SET last_login_at = ?, last_seen_at = ? WHERE admin_id = ?', [loginTime, loginTime, admin.admin_id])).catch(() => {});
    await logActivity({ adminId: admin.admin_id, fullName: admin.full_name, username: admin.username }, 'admin.login', 'Logged in', 'admin', admin.admin_id);

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
// =====================================================
// FORGOT PASSWORD (customers)
//   1) /forgot-password : a 6-digit code is emailed to the email of the account
//   2) /reset-password  : the code + a new password are sent, and the password is changed
// The answers never tell whether an account exists (so nobody can use this to find out who has an account).
// The code only goes to an email the customer VERIFIED, and only for an active account.
// =====================================================
const FORGOT_MESSAGE = 'If an account with that email or username exists and its email is verified, we sent a 6-digit code to it. Check your inbox and your Spam folder.';

function resetIdentifier(body) {
  return String((body && (body.identifier || body.email)) || '').trim().toLowerCase();
}

async function findCustomerForReset(identifier) {
  // An "@" means it is an email; usernames can never contain "@"
  const column = identifier.includes('@') ? 'email' : 'username';
  const [rows] = await pool.query(
    `SELECT user_id, full_name, first_name, email, email_verified, is_active, account_status FROM users WHERE ${column} = ?`,
    [identifier]
  );
  const user = rows[0];
  if (!user || !user.email || !user.email_verified) return null;
  if (!user.is_active || (user.account_status && user.account_status !== 'active')) return null; // suspended, banned, or deleted
  return user;
}

app.post('/api/auth/customers/forgot-password', async (req, res) => {
  try {
    const identifier = resetIdentifier(req.body);
    if (!identifier || identifier.length > 100) return res.status(400).json({ error: 'Please enter your email or username.' });
    if (!allow('forgot|' + req.ip, 10, 3600000) || !allow('forgot-id|' + identifier, 5, 3600000)) {
      return res.status(429).json({ error: 'Too many requests. Please try again in an hour.' });
    }
    // if emailing is not set up, it is the same for everybody, so it can be said openly
    if (!process.env.BREVO_API_KEY || !process.env.EMAIL_FROM) {
      return res.status(503).json({ error: 'Email sending is not set up on the server yet.' });
    }

    const user = await findCustomerForReset(identifier);
    if (user) {
      try {
        await issueVerificationCode('customer', user.user_id, user.email, user.first_name || user.full_name, {
          subject: 'Reset your Fitora Gear password',
          intro: 'Use this code to reset your password:',
        });
      } catch (err) {
        // "a code was just sent" (cooldown) and a failed email look the same from the outside
        console.warn('The password reset code was not sent:', err.message);
      }
    }
    res.json({ message: FORGOT_MESSAGE });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/auth/customers/reset-password', async (req, res) => {
  try {
    const body = req.body || {};
    const identifier = resetIdentifier(body);
    const code = String(body.code || '').trim();
    const newPassword = String(body.new_password || '');
    if (!identifier) return res.status(400).json({ error: 'Please enter your email or username.' });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Please enter the 6-digit code.' });
    if (!STRONG_PASSWORD_RE.test(newPassword)) return res.status(400).json({ error: PASSWORD_MESSAGE });
    if (!allow('reset|' + req.ip, 30, 3600000)) return res.status(429).json({ error: 'Too many attempts. Please try again in an hour.' });

    const user = await findCustomerForReset(identifier);
    // the same words as a real "no code" answer, so an unknown account looks like an account with no code
    if (!user) return res.status(400).json({ error: 'No code found. Please request a new code.' });

    const result = await checkVerificationCode('customer', user.user_id, user.email, code);
    if (!result.ok) return res.status(result.status).json({ error: result.message });

    await pool.query('UPDATE users SET password = ? WHERE user_id = ?', [await bcrypt.hash(newPassword, 10), user.user_id]);

    // a short notice to the owner of the email (it never stops the reset)
    sendEmail({
      to: user.email,
      subject: 'Your Fitora Gear password was changed',
      html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
        <h2 style="color:#FC408C;margin:0 0 12px">Fitora Gear</h2>
        <p>Hi ${escapeHtml(user.first_name || user.full_name)},</p>
        <p>The password of your account was just changed. If it was you, you do not need to do anything.</p>
        <p style="color:#b8352a">If it was not you, please contact the shop right away.</p>
      </div>`,
    }).catch((err) => console.warn('The password changed notice was not sent:', err.message));

    res.json({ message: 'Your password was changed. You can log in now.' });
  } catch (err) {
    handleError(res, err);
  }
});

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
              profile_photo, is_active, account_status, status_reason, email_verified, DATE_FORMAT(birthday, '%Y-%m-%d') AS birthday
       FROM users WHERE ${column} = ?`,
      [identifier]
    );
    const user = rows[0];
    const matches = user ? await bcrypt.compare(password, user.password) : false;

    if (!matches) {
      return res.status(401).json({ error: 'Incorrect email/username or password.' });
    }
    if (user.account_status === 'deleted') {
      return res.status(401).json({ error: 'Incorrect email/username or password.' });
    }
    if (!user.is_active || (user.account_status && user.account_status !== 'active')) {
      return res.status(403).json({ error: accountBlockedMessage(user.account_status, user.status_reason), code: 'ACCOUNT_BLOCKED' });
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
// What the customer is told when the shop suspended or banned the account
const CUSTOMER_STATUS_REASONS = [
  'Suspicious activity',
  'Fake orders or non-payment',
  'Abusive behavior',
  'Violated the shop policy',
  'Requested by the customer',
  'Other',
];
function accountBlockedMessage(status, reason) {
  const why = reason ? ` Reason: ${reason}.` : '';
  if (status === 'banned') return `Your account has been banned.${why} Please contact the shop if you think this is a mistake.`;
  return `Your account has been suspended.${why} Please contact the shop to ask when it will be restored.`;
}

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
      'SELECT user_id, full_name, email, email_verified, is_active, account_status, status_reason FROM users WHERE user_id = ?',
      [decoded.userId]
    );
    if (rows.length === 0 || rows[0].account_status === 'deleted') {
      return res.status(401).json({ error: 'This account is no longer available. Please log in again.' });
    }
    if (!rows[0].is_active || (rows[0].account_status && rows[0].account_status !== 'active')) {
      // 401 so the app logs the customer out; the message says why
      return res.status(401).json({ error: accountBlockedMessage(rows[0].account_status, rows[0].status_reason), code: 'ACCOUNT_BLOCKED' });
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
    if (has('birthday') && String(body.birthday).trim() !== '') {
      const birthday = String(body.birthday).trim();
      if (!isValidDate(birthday)) return res.status(400).json({ error: 'Birthday must be a real date in YYYY-MM-DD format.' });
      const age = ageFromBirthday(birthday);
      if (age < 13 || age > 120) return res.status(400).json({ error: 'You must be at least 13 years old.' });
      fields.push('birthday = ?');
      values.push(birthday);
      customer.birthday = birthday;
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
      SELECT u.user_id, u.full_name, u.username, u.email, u.phone, u.address, u.is_active, u.account_status, u.status_reason, u.email_verified, u.created_at,
             COUNT(o.order_id) AS order_count
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.user_id
      WHERE u.deleted_at IS NULL
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
// ADMIN: everything about ONE customer: the profile, the saved addresses, and numbers about their orders
app.get('/api/auth/customers/:id', verifyToken, requirePermission('customers'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid customer.' });

    const [rows] = await pool.query(
      `SELECT u.user_id, u.full_name, u.first_name, u.middle_name, u.last_name, u.username, u.email, u.email_verified, u.phone, u.address,
              u.profile_photo, u.is_active, u.account_status, u.status_reason, u.status_changed_at, u.deleted_at, u.created_at, DATE_FORMAT(u.birthday, '%Y-%m-%d') AS birthday
       FROM users u WHERE u.user_id = ?`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Customer not found.' });

    const [addresses] = await pool.query('SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, address_id DESC', [id]);
    const [stats] = await pool.query(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(status = 'completed'), 0) AS completed, COALESCE(SUM(status = 'cancelled'), 0) AS cancelled,
              COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total_amount END), 0) AS spent
       FROM orders WHERE user_id = ?`,
      [id]
    );

    res.json({
      ...customerProfile({ ...rows[0], order_count: stats[0].orders }),
      isActive: !!rows[0].is_active,
      accountStatus: rows[0].account_status || (rows[0].is_active ? 'active' : 'suspended'),
      statusReason: rows[0].status_reason || null,
      statusChangedAt: rows[0].status_changed_at || null,
      deletedAt: rows[0].deleted_at || null,
      addresses: addresses.map((a) => ({ ...a, is_default: !!a.is_default })),
      stats: { orders: Number(stats[0].orders), completed: Number(stats[0].completed), cancelled: Number(stats[0].cancelled), spent: Number(stats[0].spent) },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ADMIN: activate, suspend, or ban a customer (suspend and ban need a reason, which the customer is shown)
app.put('/api/auth/customers/:id/status', verifyToken, requirePermission('customers'), track(
  (req) => { const st = (req.body || {}).status || ((req.body || {}).is_active ? 'active' : 'suspended'); return st === 'banned' ? 'customer.ban' : st === 'suspended' ? 'customer.suspend' : 'customer.reactivate'; },
  {
    lookup: lookupCustomerName,
    describe: (req, name) => {
      if (!name) return null;
      const st = (req.body || {}).status || ((req.body || {}).is_active ? 'active' : 'suspended');
      const why = (req.body || {}).reason ? `: ${req.body.reason}` : '';
      return st === 'banned' ? `Banned the customer ${name}${why}` : st === 'suspended' ? `Suspended the customer ${name}${why}` : `Reactivated the customer ${name}`;
    },
    entity: (req) => ['customer', Number(req.params.id)],
  }), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid customer.' });
    const body = req.body || {};

    // the old way (is_active true / false) still works
    let status = body.status;
    let reason = String(body.reason || '');
    if (!status && body.is_active !== undefined) {
      status = body.is_active ? 'active' : 'suspended';
      reason = reason || 'Other';
    }
    if (!['active', 'suspended', 'banned'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    if (status !== 'active' && !CUSTOMER_STATUS_REASONS.includes(reason)) {
      return res.status(400).json({ error: 'Please choose a reason.' });
    }

    const [rows] = await pool.query('SELECT user_id, deleted_at FROM users WHERE user_id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Customer not found.' });
    if (rows[0].deleted_at) return res.status(400).json({ error: 'This account was already deleted.' });

    await pool.query(
      'UPDATE users SET account_status = ?, is_active = ?, status_reason = ?, status_changed_at = NOW() WHERE user_id = ?',
      [status, status === 'active' ? 1 : 0, status === 'active' ? null : reason, id]
    );
    const words = { active: 'reactivated', suspended: 'suspended', banned: 'banned' };
    res.json({ message: `The customer was ${words[status]}.`, status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// ADMIN: delete a customer. If they never ordered or reviewed, the account is removed completely.
// If they did, the order history stays for the sales records but every personal detail is erased.
app.delete('/api/auth/customers/:id', verifyToken, requirePermission('customers'), track('customer.delete', { lookup: lookupCustomerName, describe: (req, name) => (name ? `Deleted the account of the customer ${name}` : null), entity: (req) => ['customer', Number(req.params.id)] }), async (req, res) => {
  let conn;
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid customer.' });

    const [rows] = await pool.query('SELECT user_id, deleted_at FROM users WHERE user_id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Customer not found.' });
    if (rows[0].deleted_at) return res.status(400).json({ error: 'This account was already deleted.' });

    const [busy] = await pool.query("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status IN ('pending', 'processing', 'shipped')", [id]);
    if (busy[0].n > 0) {
      return res.status(400).json({ error: `This customer has ${busy[0].n} order${busy[0].n === 1 ? '' : 's'} in progress. Finish or cancel ${busy[0].n === 1 ? 'it' : 'them'} first.` });
    }

    const [history] = await pool.query(
      'SELECT (SELECT COUNT(*) FROM orders WHERE user_id = ?) AS orders, (SELECT COUNT(*) FROM reviews WHERE user_id = ?) AS reviews',
      [id, id]
    );
    if (Number(history[0].orders) === 0 && Number(history[0].reviews) === 0) {
      try {
        await pool.query('DELETE FROM users WHERE user_id = ?', [id]);
        return res.json({ message: 'The customer account was deleted.', mode: 'deleted' });
      } catch (err) {
        // something still points to this customer: erase the personal details instead (below)
      }
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query(
      `UPDATE users SET full_name = 'Deleted customer', first_name = 'Deleted', middle_name = NULL, last_name = 'customer',
         username = CONCAT('deleted_', user_id), email = CONCAT('deleted-', user_id, '@deleted.invalid'), phone = '', address = '',
         birthday = NULL, profile_photo = NULL, password = '!', email_verified = 0, is_active = 0, account_status = 'deleted',
         status_reason = NULL, status_changed_at = NOW(), deleted_at = NOW()
       WHERE user_id = ?`,
      [id]
    );
    await conn.query('DELETE FROM user_addresses WHERE user_id = ?', [id]);
    try {
      await conn.query('DELETE FROM email_verifications WHERE user_id = ?', [id]);
    } catch (err) {
      // the table may be arranged differently: it holds no personal details we must keep
    }
    await conn.commit();
    res.json({ message: 'The customer account was deleted. Their past orders stay in your records without any personal details.', mode: 'anonymized' });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) { /* ignore */ } }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  } finally {
    if (conn) conn.release();
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

async function loadAdminWithPassword(adminId) {
  const [rows] = await pool.query(
    'SELECT admin_id, username, password, full_name, email, email_verified, role FROM admins WHERE admin_id = ?',
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
app.put('/api/auth/admins/me', verifyToken, track('profile.update', {
  lookup: async (req) => { const [r] = await pool.query('SELECT full_name, email, profile_photo FROM admins WHERE admin_id = ?', [req.admin.adminId]); return r[0] || null; },
  describe: (req, before) => {
    if (!before) return null;
    const b = req.body || {};
    const changed = [];
    if (String(b.full_name || '').trim() !== before.full_name) changed.push('name');
    if (String(b.email || '').trim().toLowerCase() !== String(before.email || '').toLowerCase()) changed.push('email');
    if (b.profile_photo !== undefined && (b.profile_photo || null) !== (before.profile_photo || null)) changed.push(b.profile_photo ? 'photo' : 'photo (removed)');
    return changed.length ? `Changed own ${changed.join(', ')}` : null;
  },
  entity: (req) => ['admin', req.admin.adminId],
}), async (req, res) => {
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

    // The Super Admin confirms a new name or email with a code sent to the email (the photo needs no code).
    // That only works when the email is VERIFIED. If it is not verified (or there is no email yet, or it is a
    // wrong / non-existing address), a code could never arrive, so the name and the email can be fixed here directly.
    // The new email must then be verified with a code sent to it, and only after that do the codes protect the account.
    if (current.role === 'super_admin' && currentEmail && current.email_verified && (emailChanged || fullName !== current.full_name)) {
      return res.status(403).json({ error: 'To change your name or email, please confirm it with the code that is sent to your email.', code: 'CONFIRM_REQUIRED' });
    }

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

// The password is NOT changed here any more:
//   staff cannot change a password at all (the Super Admin resets it for them), and
//   the Super Admin changes it with the code sent to the email (see "changes" routes).
app.put('/api/auth/admins/me/password', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT role FROM admins WHERE admin_id = ?', [req.admin.adminId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Admin not found.' });
    if (rows[0].role !== 'super_admin') {
      return res.status(403).json({ error: 'Only the Super Admin can change a password. Please ask the Super Admin to change it for you.', code: 'SUPER_ADMIN_ONLY' });
    }
    return res.status(403).json({ error: 'To change your password, please confirm it with the code that is sent to your email.', code: 'CONFIRM_REQUIRED' });
  } catch (err) {
    handleError(res, err);
  }
});

// -----------------------------------------------------
// CHANGES THAT NEED A CODE FROM THE EMAIL (Super Admin: name, username, email, password)
//   1) /changes/request : the change is checked, a 6-digit code is emailed, and the change waits
//   2) /changes/confirm : the code is entered, and only then is the change saved
// The new password is kept hashed while it waits. A waiting change is forgotten after CODE_MINUTES.
// -----------------------------------------------------
const pendingChanges = new Map(); // admin id -> { details, passwordHash, expires }
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pendingChanges) if (entry.expires < now) pendingChanges.delete(key);
}, 60000).unref();

function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(name.length - 1, 6)))}@${domain}`;
}

app.post('/api/auth/admins/me/changes/request', verifyToken, async (req, res) => {
  try {
    const admin = await loadAdminWithPassword(req.admin.adminId);
    if (!admin) return res.status(404).json({ error: 'Admin not found.' });
    if (admin.role !== 'super_admin') return res.status(403).json({ error: 'Only the Super Admin confirms changes with an email code.', code: 'SUPER_ADMIN_ONLY' });
    if (!admin.email || !admin.email_verified) {
      return res.status(400).json({ error: 'Please verify your email first. Your changes are confirmed with a code that is sent to your email.', code: 'EMAIL_NOT_VERIFIED' });
    }

    const body = req.body || {};
    const details = {};
    const input = body.details || {};

    if (input.full_name !== undefined) {
      const fullName = String(input.full_name).trim();
      if (fullName.length < 2 || fullName.length > 100) return res.status(400).json({ error: 'Full name must be 2-100 characters.' });
      if (fullName !== admin.full_name) details.full_name = fullName;
    }
    if (input.username !== undefined) {
      const username = String(input.username).trim();
      if (!ADMIN_USERNAME_RE.test(username)) return res.status(400).json({ error: 'The username must be 3-30 characters: letters, numbers, dots, dashes, or underscores.' });
      if (username !== admin.username) {
        const [taken] = await pool.query('SELECT admin_id FROM admins WHERE username = ? AND admin_id <> ?', [username, admin.admin_id]);
        if (taken.length > 0) return res.status(400).json({ error: 'This username is already taken.' });
        details.username = username;
      }
    }
    if (input.email !== undefined) {
      const email = String(input.email).trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 100) return res.status(400).json({ error: 'Please enter a valid email address.' });
      if (email !== String(admin.email).toLowerCase()) details.email = email;
    }

    let passwordHash = null;
    if (body.password) {
      const currentPassword = String(body.password.current_password || '');
      const newPassword = String(body.password.new_password || '');
      if (!(await bcrypt.compare(currentPassword, admin.password))) return res.status(400).json({ error: 'Your current password is incorrect.' });
      if (!STRONG_PASSWORD_RE.test(newPassword)) return res.status(400).json({ error: PASSWORD_MESSAGE });
      if (newPassword === currentPassword) return res.status(400).json({ error: 'The new password must be different from the current one.' });
      passwordHash = await bcrypt.hash(newPassword, 10);
    }

    if (Object.keys(details).length === 0 && !passwordHash) return res.status(400).json({ error: 'Nothing was changed.' });
    if (!allow('change|' + admin.admin_id, 8, 3600000)) return res.status(429).json({ error: 'Too many requests. Please try again in an hour.' });

    // the code goes to the email the admin has now (even when the change is a new email)
    await issueVerificationCode('admin', admin.admin_id, admin.email, admin.full_name, {
      subject: 'Confirm your changes - Fitora Gear',
      intro: 'Someone asked to change your admin account details. If it was you, use this code to confirm the change:',
    });
    pendingChanges.set(admin.admin_id, { details, passwordHash, expires: Date.now() + CODE_MINUTES * 60000 });

    res.json({
      message: `We sent a 6-digit code to ${maskEmail(admin.email)}.`,
      email: maskEmail(admin.email),
      changes: { ...details, password: !!passwordHash },
    });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/auth/admins/me/changes/confirm', verifyToken, track('profile.update', { describe: (req, before, body) => (body.changed && body.changed.length ? `Changed own ${body.changed.join(', ')} (confirmed with the email code)` : null), entity: (req) => ['admin', req.admin.adminId] }), async (req, res) => {
  try {
    const admin = await loadAdminWithPassword(req.admin.adminId);
    if (!admin) return res.status(404).json({ error: 'Admin not found.' });
    if (admin.role !== 'super_admin') return res.status(403).json({ error: 'Only the Super Admin confirms changes with an email code.', code: 'SUPER_ADMIN_ONLY' });

    const code = String((req.body || {}).code || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Please enter the 6-digit code.' });

    const pending = pendingChanges.get(admin.admin_id);
    if (!pending || pending.expires < Date.now()) {
      pendingChanges.delete(admin.admin_id);
      return res.status(400).json({ error: 'There is no change waiting for a code. Please start the change again.' });
    }

    const result = await checkVerificationCode('admin', admin.admin_id, admin.email, code);
    if (!result.ok) return res.status(result.status).json({ error: result.message });

    pendingChanges.delete(admin.admin_id); // a code works only once
    const sets = [];
    const values = [];
    const d = pending.details;
    if (d.full_name !== undefined) { sets.push('full_name = ?'); values.push(d.full_name); }
    if (d.username !== undefined) { sets.push('username = ?'); values.push(d.username); }
    if (d.email !== undefined) { sets.push('email = ?', 'email_verified = 0'); values.push(d.email); }
    if (pending.passwordHash) { sets.push('password = ?'); values.push(pending.passwordHash); }
    try {
      await pool.query(`UPDATE admins SET ${sets.join(', ')} WHERE admin_id = ?`, [...values, admin.admin_id]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'This username was just taken by someone else. Please choose another.' });
      throw err;
    }
    res.json({
      message: 'Your changes were saved.',
      changed: [...(d.full_name !== undefined ? ['name'] : []), ...(d.username !== undefined ? ['username'] : []), ...(d.email !== undefined ? ['email'] : []), ...(pending.passwordHash ? ['password'] : [])],
      emailChanged: d.email !== undefined,
      passwordChanged: !!pending.passwordHash,
      admin: adminProfile(await loadAdmin(admin.admin_id)),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/auth/admins - listahan ng lahat ng admin accounts (walang kasamang password)
// Super Admin lang ang makakakita nito
const ONLINE_WINDOW_MS = 2 * 60 * 1000; // an admin who did something in the last 2 minutes is "online"

const isMissingColumn = (err) => err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE');
const MIGRATION_HINT = 'The database was not updated yet. Run migration_admin_activity.sql in MySQL Workbench first.';

app.get('/api/auth/admins', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    let rows;
    try {
      [rows] = await pool.query(
        'SELECT admin_id, username, full_name, email, email_verified, profile_photo, role, permissions, created_at, is_active, last_seen_at, last_login_at FROM admins ORDER BY created_at DESC'
      );
    } catch (err) {
      if (!isMissingColumn(err)) throw err;
      // the database was not updated yet: the list still works (everybody is shown as active, nobody as online)
      [rows] = await pool.query('SELECT admin_id, username, full_name, email, email_verified, profile_photo, role, permissions, created_at FROM admins ORDER BY created_at DESC');
      rows = rows.map((r) => ({ ...r, is_active: 1, last_seen_at: null, last_login_at: null }));
    }
    const now = Date.now();
    res.json(rows.map((r) => ({
      ...r,
      is_active: r.is_active === 0 ? 0 : 1,
      online: r.is_active !== 0 && !!r.last_seen_at && now - new Date(r.last_seen_at).getTime() < ONLINE_WINDOW_MS,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// The admin pressed "Log out": shown as offline at once
app.post('/api/auth/admins/me/logout', verifyToken, async (req, res) => {
  try {
    await Promise.resolve(pool.query('UPDATE admins SET last_seen_at = NULL WHERE admin_id = ?', [req.admin.adminId])).catch(() => {});
    await logActivity(req.admin, 'admin.logout', 'Logged out', 'admin', req.admin.adminId);
    res.json({ message: 'Logged out.' });
  } catch (err) {
    handleError(res, err);
  }
});

// The Super Admin logs an admin out: their login stops working at once, but they can log in again.
app.post('/api/auth/admins/:id/force-logout', verifyToken, requireSuperAdmin, track('admin.force_logout', { lookup: lookupAdminName, describe: (req, name) => (name ? `Logged out ${name}` : null), entity: (req) => ['admin', Number(req.params.id)] }), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid admin.' });
    if (id === req.admin.adminId) return res.status(400).json({ error: 'You cannot log yourself out here. Use "Log out" instead.' });
    const [rows] = await pool.query('SELECT admin_id FROM admins WHERE admin_id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Admin not found.' });
    // every login made before this moment stops working (the time is cut to whole seconds, like the time inside a login)
    await pool.query('UPDATE admins SET sessions_valid_after = ?, last_seen_at = NULL WHERE admin_id = ?', [new Date(Math.floor(Date.now() / 1000) * 1000), id]);
    res.json({ message: 'The admin was logged out. They can log in again.' });
  } catch (err) {
    if (isMissingColumn(err)) return res.status(503).json({ error: MIGRATION_HINT });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// The Super Admin deactivates an admin (cannot log in, and is stopped at once) or activates the account again.
app.put('/api/auth/admins/:id/active', verifyToken, requireSuperAdmin, track((req) => (req.body && req.body.active === false ? 'admin.deactivate' : 'admin.activate'), { lookup: lookupAdminName, describe: (req, name) => (name ? (req.body.active === false ? `Deactivated the admin account of ${name}` : `Activated the admin account of ${name}`) : null), entity: (req) => ['admin', Number(req.params.id)] }), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid admin.' });
    const active = (req.body || {}).active;
    if (typeof active !== 'boolean') return res.status(400).json({ error: 'Please say whether the account should be active or not.' });
    if (id === req.admin.adminId) return res.status(400).json({ error: 'You cannot deactivate your own account.' });

    const [rows] = await pool.query('SELECT admin_id, role FROM admins WHERE admin_id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Admin not found.' });
    if (!active && rows[0].role === 'super_admin') {
      const [others] = await pool.query("SELECT COUNT(*) AS n FROM admins WHERE role = 'super_admin' AND is_active = 1 AND admin_id <> ?", [id]);
      if (Number(others[0].n) === 0) return res.status(400).json({ error: 'There must always be at least one active Super Admin.' });
    }
    if (active) {
      await pool.query('UPDATE admins SET is_active = 1 WHERE admin_id = ?', [id]);
    } else {
      await pool.query('UPDATE admins SET is_active = 0, sessions_valid_after = ?, last_seen_at = NULL WHERE admin_id = ?', [new Date(Math.floor(Date.now() / 1000) * 1000), id]);
    }
    res.json({ message: active ? 'The account is active again.' : 'The account was deactivated. The admin is logged out right away.' });
  } catch (err) {
    if (isMissingColumn(err)) return res.status(503).json({ error: MIGRATION_HINT });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// The activity log (Super Admin only): who did what, newest first. Filters: admin, type, dates (shop time), and "load more".
const ACTIVITY_TYPES = ['product', 'stock', 'category', 'order', 'customer', 'review', 'admin', 'profile'];
const SHOP_DAY_START = (key) => new Date(key + 'T00:00:00+08:00'); // EDIT DITO: the Philippines is UTC+8

app.get('/api/auth/admin-activity', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const q = req.query || {};
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    const where = [];
    const params = [];
    if (q.admin_id) {
      const adminId = Number(q.admin_id);
      if (!Number.isInteger(adminId) || adminId <= 0) return res.status(400).json({ error: 'Invalid admin.' });
      where.push('admin_id = ?'); params.push(adminId);
    }
    if (q.type) {
      if (!ACTIVITY_TYPES.includes(q.type)) return res.status(400).json({ error: 'Invalid type.' });
      where.push('action LIKE ?'); params.push(q.type + '.%');
    }
    for (const key of ['from', 'to']) {
      if (q[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(q[key]) || Number.isNaN(SHOP_DAY_START(q[key]).getTime()))) return res.status(400).json({ error: 'Please choose valid dates.' });
    }
    if (q.from) { where.push('created_at >= ?'); params.push(SHOP_DAY_START(q.from)); }
    if (q.to) { where.push('created_at < ?'); params.push(new Date(SHOP_DAY_START(q.to).getTime() + 86400000)); }
    if (q.before) {
      const before = Number(q.before);
      if (!Number.isInteger(before) || before <= 0) return res.status(400).json({ error: 'Invalid page.' });
      where.push('activity_id < ?'); params.push(before);
    }
    const [rows] = await pool.query(
      `SELECT activity_id, admin_id, admin_name, action, description, entity_type, entity_id, created_at
       FROM admin_activity ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY activity_id DESC LIMIT ?`,
      [...params, limit + 1]
    );
    res.json({ items: rows.slice(0, limit), hasMore: rows.length > limit });
  } catch (err) {
    if (err && err.code === 'ER_NO_SUCH_TABLE') return res.json({ items: [], hasMore: false, notReady: true });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// The modules a staff member can be given access to
const ADMIN_PERMISSION_KEYS = ['products', 'categories', 'inventory', 'customers', 'orders', 'reports', 'reviews'];
const ADMIN_USERNAME_RE = /^[A-Za-z0-9_.-]{3,30}$/;

// Checks the fields of an admin account (used when adding and when editing)
function checkAdminFields(body) {
  const fullName = String(body.full_name || '').trim();
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const role = body.role === 'super_admin' ? 'super_admin' : 'staff';
  const permissions = Array.isArray(body.permissions) ? body.permissions : [];

  if (fullName.length < 2 || fullName.length > 100) return { error: 'Full name must be 2-100 characters.' };
  if (!ADMIN_USERNAME_RE.test(username)) return { error: 'The username must be 3-30 characters: letters, numbers, dots, dashes, or underscores.' };
  if (email && (!EMAIL_RE.test(email) || email.length > 100)) return { error: 'Please enter a valid email address.' };
  if (permissions.some((p) => !ADMIN_PERMISSION_KEYS.includes(p))) return { error: 'One of the modules is not valid.' };

  return { data: { fullName, username, email: email || null, role, permissions: role === 'staff' ? [...new Set(permissions)].join(',') || null : null } };
}

async function countSuperAdmins() {
  const [rows] = await pool.query("SELECT COUNT(*) AS n FROM admins WHERE role = 'super_admin'");
  return Number(rows[0].n);
}

// POST /api/auth/admins - gumawa ng bagong admin account
app.post('/api/auth/admins', verifyToken, requireSuperAdmin, track('admin.create', { describe: (req, before, body) => `Added the admin account of ${body.full_name} (@${body.username}) as ${body.role === 'super_admin' ? 'Super Admin' : 'staff'}`, entity: (req, before, body) => ['admin', body.admin_id] }), async (req, res) => {
  try {
    const body = req.body || {};
    const parsed = checkAdminFields(body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const password = String(body.password || '');
    if (!STRONG_PASSWORD_RE.test(password)) return res.status(400).json({ error: PASSWORD_MESSAGE });

    const d = parsed.data;
    const [result] = await pool.query(
      'INSERT INTO admins (username, password, full_name, email, role, permissions) VALUES (?, ?, ?, ?, ?, ?)',
      [d.username, await bcrypt.hash(password, 10), d.fullName, d.email, d.role, d.permissions]
    );
    res.status(201).json({ admin_id: result.insertId, username: d.username, full_name: d.fullName, email: d.email, role: d.role, permissions: parsePermissions(d.permissions) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'This username is already taken.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// PUT /api/auth/admins/:id - the Super Admin edits the details of another admin
app.put('/api/auth/admins/:id', verifyToken, requireSuperAdmin, track('admin.update', { lookup: lookupAdminName, describe: (req, name) => (name ? `Edited the admin account of ${name}` : null), entity: (req) => ['admin', Number(req.params.id)] }), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid admin.' });
    // your own details (and their confirmation code) are in My profile
    if (id === req.admin.adminId) return res.status(400).json({ error: 'Please change your own details in My profile.' });
    const parsed = checkAdminFields(req.body || {});
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const d = parsed.data;

    const [rows] = await pool.query('SELECT admin_id, role, email FROM admins WHERE admin_id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Admin not found.' });
    const target = rows[0];

    if (id === req.admin.adminId && d.role !== 'super_admin') {
      return res.status(400).json({ error: 'You cannot remove your own Super Admin role.' });
    }
    if (target.role === 'super_admin' && d.role !== 'super_admin' && (await countSuperAdmins()) <= 1) {
      return res.status(400).json({ error: 'There must always be at least one Super Admin.' });
    }

    const currentEmail = target.email ? String(target.email).toLowerCase() : null;
    const emailChanged = d.email !== currentEmail;
    await pool.query(
      'UPDATE admins SET full_name = ?, username = ?, email = ?, role = ?, permissions = ?, email_verified = IF(?, 0, email_verified) WHERE admin_id = ?',
      [d.fullName, d.username, d.email, d.role, d.permissions, emailChanged ? 1 : 0, id]
    );
    res.json({ message: 'The admin account was updated.', admin: adminProfile(await loadAdmin(id)) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'This username is already taken.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// PUT /api/auth/admins/:id/password - the Super Admin sets a new password for another admin
app.put('/api/auth/admins/:id/password', verifyToken, requireSuperAdmin, track('admin.password_reset', { lookup: lookupAdminName, describe: (req, name) => (name ? `Reset the password of ${name}` : null), entity: (req) => ['admin', Number(req.params.id)] }), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid admin.' });
    if (id === req.admin.adminId) return res.status(400).json({ error: 'Use "Change password" in your profile to change your own password.' });
    const newPassword = String((req.body || {}).new_password || '');
    if (!STRONG_PASSWORD_RE.test(newPassword)) return res.status(400).json({ error: PASSWORD_MESSAGE });

    const [rows] = await pool.query('SELECT admin_id FROM admins WHERE admin_id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Admin not found.' });
    await pool.query('UPDATE admins SET password = ? WHERE admin_id = ?', [await bcrypt.hash(newPassword, 10), id]);
    res.json({ message: 'The new password was saved. Tell the admin the new password.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// DELETE /api/auth/admins/:id - tanggalin ang isang admin account
app.delete('/api/auth/admins/:id', verifyToken, requireSuperAdmin, track('admin.delete', { lookup: lookupAdminName, describe: (req, name) => (name ? `Deleted the admin account of ${name}` : null), entity: (req) => ['admin', Number(req.params.id)] }), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid admin.' });
    if (id === req.admin.adminId) return res.status(400).json({ error: 'You cannot delete your own account.' });

    const [rows] = await pool.query('SELECT admin_id, role FROM admins WHERE admin_id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Admin not found.' });
    if (rows[0].role === 'super_admin' && (await countSuperAdmins()) <= 1) {
      return res.status(400).json({ error: 'There must always be at least one Super Admin.' });
    }

    // the records the admin made stay, but they no longer point to the deleted account
    for (const sql of ['UPDATE stock_logs SET admin_id = NULL WHERE admin_id = ?', 'DELETE FROM admin_notification_reads WHERE admin_id = ?', 'DELETE FROM email_verifications WHERE admin_id = ?']) {
      try { await pool.query(sql, [id]); } catch (err) { /* that table may be arranged differently: not important */ }
    }
    await pool.query('DELETE FROM admins WHERE admin_id = ?', [id]);
    res.json({ message: 'Admin account deleted. They are logged out right away.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// =====================================================
// CUSTOMER ADDRESS BOOK (delivery addresses)
// =====================================================
const MAX_ADDRESSES = 10;

function addressText(value, max) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max + 1);
}
function addressCode(value) {
  return /^\d{1,12}$/.test(String(value == null ? '' : value)) ? String(value) : null;
}

// Checks the body of "add/edit address". Returns { error } or { data }.
function parseAddressBody(body) {
  const b = body || {};
  const data = {
    recipient_name: addressText(b.recipient_name, 100),
    phone: String(b.phone || '').replace(/[\s()-]/g, ''),
    region_code: addressCode(b.region_code),
    region_name: addressText(b.region_name, 100),
    province_code: addressCode(b.province_code),
    province_name: addressText(b.province_name, 100),
    city_code: addressCode(b.city_code),
    city_name: addressText(b.city_name, 100),
    barangay_code: addressCode(b.barangay_code),
    barangay_name: addressText(b.barangay_name, 100),
    street: addressText(b.street, 200),
    zip_code: String(b.zip_code || '').trim(),
    landmark: addressText(b.landmark, 150) || null,
    label: b.label === 'office' ? 'office' : 'home',
    is_default: b.is_default === true || b.is_default === 1,
  };
  if (data.recipient_name.length < 2 || data.recipient_name.length > 100) return { error: 'Please enter the recipient name (2-100 characters).' };
  if (!/^\+?\d{7,15}$/.test(data.phone)) return { error: 'Please enter a valid phone number (7-15 digits).' };
  const required = [['region_name', 'region'], ['province_name', 'province'], ['city_name', 'city or municipality'], ['barangay_name', 'barangay']];
  for (const [key, label] of required) {
    if (data[key].length < 2 || data[key].length > 100) return { error: `Please choose or enter the ${label}.` };
  }
  if (data.street.length < 3 || data.street.length > 200) return { error: 'Please enter the house number, street, or building (3-200 characters).' };
  if (!/^\d{4}$/.test(data.zip_code)) return { error: 'The ZIP code must be exactly 4 digits.' };
  if (data.landmark && data.landmark.length > 150) return { error: 'The landmark is too long (150 characters maximum).' };
  return { data };
}

const ADDRESS_COLUMNS = [
  'recipient_name', 'phone', 'region_code', 'region_name', 'province_code', 'province_name',
  'city_code', 'city_name', 'barangay_code', 'barangay_name', 'street', 'zip_code', 'landmark', 'label',
];

app.get('/api/auth/customers/me/addresses', verifyCustomerToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, address_id DESC',
      [req.customer.userId]
    );
    res.json(rows.map((row) => ({ ...row, is_default: !!row.is_default })));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/auth/customers/me/addresses', verifyCustomerToken, async (req, res) => {
  let conn;
  try {
    const parsed = parseAddressBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const a = parsed.data;
    const userId = req.customer.userId;

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM user_addresses WHERE user_id = ?', [userId]);
    if (total >= MAX_ADDRESSES) {
      await conn.rollback();
      return res.status(400).json({ error: `You can save up to ${MAX_ADDRESSES} addresses. Please delete one first.` });
    }

    // The first address, or one marked as default, becomes the default
    const makeDefault = a.is_default || total === 0;
    if (makeDefault) await conn.query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [userId]);

    const [result] = await conn.query(
      `INSERT INTO user_addresses (user_id, ${ADDRESS_COLUMNS.join(', ')}, is_default)
       VALUES (?, ${ADDRESS_COLUMNS.map(() => '?').join(', ')}, ?)`,
      [userId, ...ADDRESS_COLUMNS.map((column) => a[column]), makeDefault ? 1 : 0]
    );
    await conn.commit();
    res.status(201).json({ address_id: result.insertId, message: 'Address saved.' });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) { /* ignore */ } }
    handleError(res, err);
  } finally {
    if (conn) conn.release();
  }
});

app.put('/api/auth/customers/me/addresses/:id/default', verifyCustomerToken, async (req, res) => {
  let conn;
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid address.' });
    const userId = req.customer.userId;

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT address_id FROM user_addresses WHERE address_id = ? AND user_id = ?', [id, userId]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Address not found.' });
    }
    await conn.query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [userId]);
    await conn.query('UPDATE user_addresses SET is_default = 1 WHERE address_id = ? AND user_id = ?', [id, userId]);
    await conn.commit();
    res.json({ message: 'Default address updated.' });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) { /* ignore */ } }
    handleError(res, err);
  } finally {
    if (conn) conn.release();
  }
});

app.put('/api/auth/customers/me/addresses/:id', verifyCustomerToken, async (req, res) => {
  let conn;
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid address.' });
    const parsed = parseAddressBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const a = parsed.data;
    const userId = req.customer.userId;

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT address_id, is_default FROM user_addresses WHERE address_id = ? AND user_id = ?', [id, userId]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Address not found.' });
    }
    if (a.is_default) await conn.query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [userId]);

    await conn.query(
      `UPDATE user_addresses SET ${ADDRESS_COLUMNS.map((column) => `${column} = ?`).join(', ')}, is_default = ?
       WHERE address_id = ? AND user_id = ?`,
      [...ADDRESS_COLUMNS.map((column) => a[column]), a.is_default ? 1 : (rows[0].is_default ? 1 : 0), id, userId]
    );
    await conn.commit();
    res.json({ message: 'Address updated.' });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) { /* ignore */ } }
    handleError(res, err);
  } finally {
    if (conn) conn.release();
  }
});

app.delete('/api/auth/customers/me/addresses/:id', verifyCustomerToken, async (req, res) => {
  let conn;
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid address.' });
    const userId = req.customer.userId;

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT address_id, is_default FROM user_addresses WHERE address_id = ? AND user_id = ?', [id, userId]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Address not found.' });
    }
    await conn.query('DELETE FROM user_addresses WHERE address_id = ? AND user_id = ?', [id, userId]);
    // If the default address was deleted, the newest remaining one becomes the default
    if (rows[0].is_default) {
      await conn.query('UPDATE user_addresses SET is_default = 1 WHERE user_id = ? ORDER BY address_id DESC LIMIT 1', [userId]);
    }
    await conn.commit();
    res.json({ message: 'Address deleted.' });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) { /* ignore */ } }
    handleError(res, err);
  } finally {
    if (conn) conn.release();
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});