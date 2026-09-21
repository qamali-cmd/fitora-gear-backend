// server.js - Auth Service
// Ito ang API na hahawak ng LOGIN ng admin AT ng customer (mobile app).
// Tumatakbo ito sa sarili niyang "port" (http://localhost:4000)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { verifyToken, requireSuperAdmin, requirePermission } = require('./middleware');

const app = express();
app.use(cors()); // para pwedeng tumawag ang admin-web (HTML/JS) sa API na ito
app.use(express.json()); // para ma-basa natin ang JSON na ipinadala ng frontend

const JWT_SECRET = process.env.JWT_SECRET;

// -----------------------------------------------------
// POST /api/auth/login (ADMIN login)
// Tinatanggap: { username, password }
// Ibinabalik: { token, admin: {...} } kung tama, o error kung mali
// -----------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Kailangan ng username at password.' });
    }

    const [rows] = await pool.query('SELECT * FROM admins WHERE username = ?', [username]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Mali ang username o password.' });
    }

    const admin = rows[0];
    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      return res.status(401).json({ error: 'Mali ang username o password.' });
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
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'May problema sa server. Subukan ulit.' });
  }
});

// -----------------------------------------------------
// GET /api/auth/verify - i-check kung valid pa ang admin token
// -----------------------------------------------------
app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ valid: false, error: 'Walang token.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, admin: decoded });
  } catch (err) {
    res.status(401).json({ valid: false, error: 'Expired o invalid na ang token.' });
  }
});

// =====================================================
// CUSTOMER AUTH (para sa mobile app - iba ito sa admin login)
// =====================================================

// POST /api/auth/customers/register - gumawa ng bagong customer account
app.post('/api/auth/customers/register', async (req, res) => {
  try {
    const { full_name, email, password, phone, address, birthday } = req.body;

    // EDIT DITO: kung gusto mong baguhin ang mga required fields
    if (!full_name || !email || !password || !phone || !birthday) {
      return res.status(400).json({ error: 'Kailangan ng pangalan, email, password, phone number, at birthday.' });
    }

    // Mas strict na password rule: min. 8 characters, may uppercase, lowercase,
    // number, at special character
    const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
    if (!strongPassword.test(password)) {
      return res.status(400).json({
        error: 'Ang password ay dapat hindi bababa sa 8 characters, may malaki at maliit na letra, numero, at special character (hal. !@#$%).',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      'INSERT INTO users (full_name, email, password, phone, address, birthday) VALUES (?, ?, ?, ?, ?, ?)',
      [full_name, email, hashedPassword, phone, address || null, birthday]
    );

    const token = jwt.sign(
      { userId: result.insertId, email, type: 'customer' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({
      token,
      customer: { id: result.insertId, fullName: full_name, email, phone, address: address || null, birthday },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'May account na gamit ang email na ito.' });
    }
    console.error(err);
    res.status(500).json({ error: 'May problema sa server.' });
  }
});

// POST /api/auth/customers/login
app.post('/api/auth/customers/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Kailangan ng email at password.' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Mali ang email o password.' });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Naka-deactivate ang account mo. I-contact ang support.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Mali ang email o password.' });
    }

    const token = jwt.sign(
      { userId: user.user_id, email: user.email, type: 'customer' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      customer: { id: user.user_id, fullName: user.full_name, email: user.email, phone: user.phone, address: user.address, birthday: user.birthday },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'May problema sa server.' });
  }
});

// BAGO: guard para sa customer-only routes (ginagamit lang dito sa auth-service)
function verifyCustomerToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Kailangan mag-login muna.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'customer') {
      return res.status(403).json({ error: 'Customer account lang ang pwedeng gumamit nito.' });
    }
    req.customer = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Expired o invalid na ang session mo.' });
  }
}

// BAGO: PUT /api/auth/customers/me - i-update ng customer ang sariling profile
// (pangalan, phone, address - ginagamit ng "Edit profile" sa mobile app)
app.put('/api/auth/customers/me', verifyCustomerToken, async (req, res) => {
  try {
    const { full_name, phone, address } = req.body;

    if (!full_name) {
      return res.status(400).json({ error: 'Kailangan ng pangalan.' });
    }

    await pool.query(
      'UPDATE users SET full_name = ?, phone = ?, address = ? WHERE user_id = ?',
      [full_name, phone || null, address || null, req.customer.userId]
    );

    res.json({
      message: 'Na-update na ang profile mo.',
      customer: { fullName: full_name, phone: phone || null, address: address || null },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'May problema sa server.' });
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
      SELECT u.user_id, u.full_name, u.email, u.phone, u.address, u.is_active, u.created_at,
             COUNT(o.order_id) AS order_count
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.user_id
      GROUP BY u.user_id
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'May problema sa server.' });
  }
});

// PUT /api/auth/customers/:id/status - i-activate o i-deactivate ang isang customer account
app.put('/api/auth/customers/:id/status', verifyToken, requirePermission('customers'), async (req, res) => {
  try {
    const { is_active } = req.body;
    await pool.query('UPDATE users SET is_active = ? WHERE user_id = ?', [is_active ? 1 : 0, req.params.id]);
    res.json({ message: 'Na-update na ang status ng customer.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'May problema sa server.' });
  }
});

// =====================================================
// ADMIN MANAGEMENT
// (para sa mga miyembro ng grupo na kailangan din ng sariling admin login)
// =====================================================

// GET /api/auth/admins - listahan ng lahat ng admin accounts (walang kasamang password)
// Super Admin lang ang makakakita nito
app.get('/api/auth/admins', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT admin_id, username, full_name, email, role, permissions, created_at FROM admins ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'May problema sa server.' });
  }
});

// POST /api/auth/admins - gumawa ng bagong admin account
app.post('/api/auth/admins', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, full_name, email, role, permissions } = req.body;

    if (!username || !password || !full_name) {
      return res.status(400).json({ error: 'Kailangan ng username, password, at full name.' });
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
      return res.status(400).json({ error: 'Ginagamit na ang username na ito.' });
    }
    console.error(err);
    res.status(500).json({ error: 'May problema sa server.' });
  }
});

// DELETE /api/auth/admins/:id - tanggalin ang isang admin account
app.delete('/api/auth/admins/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.admin.adminId) {
      return res.status(400).json({ error: 'Hindi mo pwedeng tanggalin ang sarili mong account.' });
    }
    await pool.query('DELETE FROM admins WHERE admin_id = ?', [req.params.id]);
    res.json({ message: 'Na-delete na ang admin account.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'May problema sa server.' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});
