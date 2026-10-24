// server.js - Product Service
// Ito ang API na hahawak ng PRODUCTS, CATEGORIES, INVENTORY, at REVIEWS.
// Tumatakbo ito sa http://localhost:4001

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { verifyToken, requirePermission, verifyCustomerToken } = require('./middleware');

const app = express();
app.use(cors());
app.use(express.json());

// =====================================================
// CATEGORIES
// =====================================================

// GET /api/categories - kunin lahat ng categories (walang kailangang login,
// pwede rin itong gamitin ng client/mobile app sa hinaharap)
// =====================================================
// APPROVAL OF NEW PRODUCTS
// A product added by a STAFF admin is saved as "pending" and stays inactive (hidden from customers) until a
// Super Admin approves it. A product added by a Super Admin is approved at once.
// =====================================================
const isSuperAdmin = (req) => !!req.admin && req.admin.role === 'super_admin';
const isMissingColumn = (err) => !!err && err.code === 'ER_BAD_FIELD_ERROR';
const APPROVAL_HINT = 'The database was not updated yet. Run migration_product_approval.sql in MySQL Workbench first.';
const REJECT_REASONS = ['Wrong price', 'Wrong or missing photo', 'Wrong name or description', 'Not allowed to sell', 'Other'];
const adminLabel = (req) => (req.admin && (req.admin.fullName || req.admin.username)) || 'An admin';

// The approval state of a product. A product made before the update (or a database without the new columns) counts as approved.
async function getApproval(productId) {
  try {
    const [rows] = await pool.query('SELECT approval_status FROM products WHERE product_id = ?', [productId]);
    return rows[0] ? { status: rows[0].approval_status || 'approved' } : null;
  } catch (err) {
    if (isMissingColumn(err)) return null;
    throw err;
  }
}

// Who a product is for
const AUDIENCES = ['men', 'women', 'unisex'];
const AUDIENCE_ERROR = 'Please choose who the product is for: men, women, or unisex.';

// The categories, with how many products each one has and how many are for men, women, or everyone
app.get('/api/categories', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, COUNT(p.product_id) AS product_count,
             COALESCE(SUM(p.audience = 'men'), 0) AS men_count,
             COALESCE(SUM(p.audience = 'women'), 0) AS women_count,
             COALESCE(SUM(p.audience = 'unisex'), 0) AS unisex_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.category_id
      GROUP BY c.category_id
      ORDER BY c.category_name
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// POST /api/categories - gumawa ng bagong category (kailangan naka-login)
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

const lookupProductName = async (req) => { const [r] = await pool.query('SELECT product_name FROM products WHERE product_id = ?', [Number(req.params.id)]); return r[0] ? r[0].product_name : null; };
const lookupCategoryName = async (req) => { const [r] = await pool.query('SELECT category_name FROM categories WHERE category_id = ?', [Number(req.params.id)]); return r[0] ? r[0].category_name : null; };
const lookupReview = async (req) => {
  const [r] = await pool.query('SELECT r.status, p.product_name, u.full_name AS customer_name FROM reviews r LEFT JOIN products p ON p.product_id = r.product_id LEFT JOIN users u ON u.user_id = r.user_id WHERE r.review_id = ?', [Number(req.params.id)]);
  return r[0] || null;
};
const lookupImageProduct = async (req) => { const [r] = await pool.query('SELECT p.product_name FROM product_images i JOIN products p ON p.product_id = i.product_id WHERE i.image_id = ?', [Number(req.params.imageId)]); return r[0] ? r[0].product_name : null; };

app.post('/api/categories', verifyToken, requirePermission('categories'), track('category.create', { describe: (req) => `Added the category "${req.body.category_name}"`, entity: (req, b, body) => ['category', body.category_id] }), async (req, res) => {
  try {
    const { category_name, description } = req.body;
    if (!category_name) {
      return res.status(400).json({ error: 'Category name is required.' });
    }
    const [result] = await pool.query(
      'INSERT INTO categories (category_name, description) VALUES (?, ?)',
      [category_name, description || null]
    );
    res.status(201).json({ category_id: result.insertId, category_name, description });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// PUT /api/categories/:id - i-update ang isang category
app.put('/api/categories/:id', verifyToken, requirePermission('categories'), track('category.update', { lookup: lookupCategoryName, describe: (req, name) => (name ? `Edited the category "${name}"${req.body.category_name && req.body.category_name !== name ? ` (now "${req.body.category_name}")` : ''}` : null), entity: (req) => ['category', Number(req.params.id)] }), async (req, res) => {
  try {
    const { category_name, description } = req.body;
    await pool.query(
      'UPDATE categories SET category_name = ?, description = ? WHERE category_id = ?',
      [category_name, description || null, req.params.id]
    );
    res.json({ message: 'Category updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// DELETE /api/categories/:id
app.delete('/api/categories/:id', verifyToken, requirePermission('categories'), track('category.delete', { lookup: lookupCategoryName, describe: (req, name) => (name ? `Deleted the category "${name}"` : null), entity: (req) => ['category', Number(req.params.id)] }), async (req, res) => {
  try {
    await pool.query('DELETE FROM categories WHERE category_id = ?', [req.params.id]);
    res.json({ message: 'Category deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// =====================================================
// PRODUCTS
// =====================================================

// GET /api/products - kunin lahat ng products (kasama ang category name)
app.get('/api/products', async (req, res) => {
  try {
    // Each product also carries what the shop window shows: how many were SOLD (items of orders that the shop
    // accepted and did not cancel) and the RATING (from the approved reviews only).
    const [rows] = await pool.query(`
      SELECT p.*, c.category_name,
        COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.order_id = oi.order_id
                  WHERE oi.product_id = p.product_id AND o.status IN ('processing', 'shipped', 'completed')), 0) AS sold_count,
        (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.product_id AND r.status = 'approved') AS rating_avg,
        (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.product_id AND r.status = 'approved') AS rating_count
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.category_id
      ORDER BY p.created_at DESC
    `);
    // who added and who approved a product is for the admins only (the Activity page): it is not sent in this public list
    res.json(rows.map(({ created_by, approved_by, approved_at, sold_count, rating_avg, rating_count, ...product }) => ({
      ...product,
      sold_count: Number(sold_count) || 0,
      rating_avg: rating_avg === null || rating_avg === undefined ? null : Number(rating_avg),
      rating_count: Number(rating_count) || 0,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// GET /api/products/low-stock - products na mababa na ang stock (halimbawa <10)
app.get('/api/products/low-stock', async (req, res) => {
  try {
    // only approved products count as "low stock" (a product waiting for approval is not for sale yet)
    let rows;
    try {
      [rows] = await pool.query("SELECT product_id, product_name, stock FROM products WHERE stock < 10 AND approval_status = 'approved' ORDER BY stock ASC");
    } catch (err) {
      if (!isMissingColumn(err)) throw err;
      [rows] = await pool.query('SELECT product_id, product_name, stock FROM products WHERE stock < 10 ORDER BY stock ASC');
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// =====================================================
// INVENTORY MANAGEMENT
// =====================================================

// POST /api/products/:id/stock-adjustment
// Why stock is removed
const STOCK_REMOVE_REASONS = ['Damaged', 'Lost', 'Other'];

// Changes the stock of a product in one of three ways:
//   add    = restock: the quantity is ADDED to the stock
//   remove = damaged / lost: the quantity is TAKEN AWAY from the stock
//   set    = correction: the stock BECOMES the quantity (it is not added)
app.post('/api/products/:id/stock-adjustment', verifyToken, requirePermission('inventory'), track('stock.adjust', {
  lookup: lookupProductName,
  describe: (req, name, body) => {
    if (!name || body.newStock === undefined) return null;
    const mode = (req.body || {}).mode || (Number((req.body || {}).change_amount) > 0 ? 'add' : 'remove');
    if (mode === 'add') return `Restocked "${name}": +${body.change} (${body.previousStock} → ${body.newStock})`;
    if (mode === 'set') return `Corrected the stock of "${name}": ${body.previousStock} → ${body.newStock}`;
    return `Removed ${Math.abs(body.change)} of "${name}"${req.body.reason ? ' (' + req.body.reason + ')' : ''}: ${body.previousStock} → ${body.newStock}`;
  },
  entity: (req) => ['product', Number(req.params.id)],
}), async (req, res) => {
  const productId = Number(req.params.id);
  const body = req.body || {};
  if (!Number.isInteger(productId) || productId <= 0) return res.status(400).json({ error: 'Invalid product.' });

  let mode = body.mode;
  let quantity = Number(body.quantity);
  let reason = String(body.reason || '');
  let legacy = false;
  if (!mode && body.change_amount !== undefined) {
    // the old way still works: one signed amount (+ adds, - removes)
    const amount = Number(body.change_amount);
    if (!Number.isInteger(amount) || amount === 0 || !reason) return res.status(400).json({ error: 'change_amount and reason are required.' });
    mode = amount < 0 ? 'remove' : 'add';
    quantity = Math.abs(amount);
    legacy = true;
  }
  if (!['add', 'remove', 'set'].includes(mode)) return res.status(400).json({ error: 'Please choose what to do with the stock: restock, remove, or correction.' });
  if (!Number.isInteger(quantity)) return res.status(400).json({ error: 'Please enter a whole number.' });
  if (mode === 'set' ? (quantity < 0 || quantity > 1000000) : (quantity < 1 || quantity > 100000)) {
    return res.status(400).json({ error: mode === 'set' ? 'The stock must be a whole number from 0 to 1,000,000.' : 'The quantity must be a whole number from 1 to 100,000.' });
  }
  if (mode === 'remove' && !legacy) {
    reason = reason || 'Damaged';
    if (!STOCK_REMOVE_REASONS.includes(reason)) return res.status(400).json({ error: 'Please choose why the stock is removed: damaged, lost, or other.' });
  }
  const note = String(body.note || '').trim().slice(0, 200);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT stock FROM products WHERE product_id = ? FOR UPDATE', [productId]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Product not found.' });
    }
    const before = rows[0].stock;

    let after;
    if (mode === 'add') {
      after = before + quantity;
    } else if (mode === 'remove') {
      after = before - quantity;
      if (after < 0) {
        await conn.rollback();
        return res.status(400).json({ error: `There are only ${before} in stock, so you cannot remove ${quantity}.` });
      }
    } else {
      after = quantity; // correction: this IS the new stock
      if (after === before) {
        await conn.rollback();
        return res.status(400).json({ error: `The stock is already ${before}. Nothing to change.` });
      }
    }

    const logReason = legacy ? reason : mode === 'add' ? 'Restock' : mode === 'set' ? 'Correction' : reason;
    await conn.query('UPDATE products SET stock = ? WHERE product_id = ?', [after, productId]);
    await conn.query(
      'INSERT INTO stock_logs (product_id, change_amount, reason, admin_id, stock_before, stock_after, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [productId, after - before, logReason, req.admin.adminId, before, after, note || null]
    );
    await conn.commit();

    await notifyLowStock(productId);
    res.json({ message: 'Stock updated.', newStock: after, previousStock: before, change: after - before });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  } finally {
    conn.release();
  }
});

// GET /api/products/stock-logs/recent
app.get('/api/products/stock-logs/recent', verifyToken, requirePermission('inventory'), async (req, res) => {
  try {
    const productId = req.query.product_id ? Number(req.query.product_id) : null;
    if (productId !== null && (!Number.isInteger(productId) || productId <= 0)) return res.status(400).json({ error: 'Invalid product.' });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const [rows] = await pool.query(`
      SELECT sl.*, p.product_name, a.full_name AS admin_name
      FROM stock_logs sl
      LEFT JOIN products p ON sl.product_id = p.product_id
      LEFT JOIN admins a ON sl.admin_id = a.admin_id
      ${productId ? 'WHERE sl.product_id = ?' : ''}
      ORDER BY sl.created_at DESC
      LIMIT ?
    `, productId ? [productId, limit] : [limit]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// GET /api/products/:id - kunin ang isang product
app.get('/api/products/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM products WHERE product_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Product not found.' });
    const { created_by, approved_by, approved_at, ...product } = rows[0]; // who added / approved it is for the admins only
    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// POST /api/products - gumawa ng bagong product
app.post('/api/products', verifyToken, requirePermission('products'), track('product.create', { describe: (req) => `Added the product "${req.body.product_name}" (₱${Number(req.body.price).toLocaleString('en-US')})${isSuperAdmin(req) ? '' : ' - waiting for approval'}`, entity: (req, b, body) => ['product', body.product_id] }), async (req, res) => {
  try {
    const { category_id, product_name, description, price, stock, image, status, weight_grams, audience } = req.body;

    if (!product_name || price == null) {
      return res.status(400).json({ error: 'Product name and price are required.' });
    }
    const weight = weight_grams === undefined || weight_grams === '' || weight_grams === null ? 300 : Number(weight_grams);
    if (!Number.isInteger(weight) || weight < 1 || weight > 50000) {
      return res.status(400).json({ error: 'Weight must be a whole number of grams between 1 and 50,000.' });
    }

    const who = audience === undefined || audience === null || audience === '' ? 'unisex' : audience;
    if (!AUDIENCES.includes(who)) return res.status(400).json({ error: AUDIENCE_ERROR });

    const staffMember = !isSuperAdmin(req);
    const finalStatus = staffMember ? 'inactive' : (status || 'active'); // a product waiting for approval is never active
    let result;
    try {
      [result] = await pool.query(
        `INSERT INTO products (category_id, product_name, description, price, stock, image, status, weight_grams, audience, approval_status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [category_id || null, product_name, description || null, price, stock || 0, image || null, finalStatus, weight, who, staffMember ? 'pending' : 'approved', req.admin.adminId || null]
      );
    } catch (err) {
      if (!isMissingColumn(err)) throw err;
      // The database was not updated yet. A staff member's product can NOT go live without the approval, so it is refused.
      if (staffMember) return res.status(503).json({ error: APPROVAL_HINT });
      [result] = await pool.query(
        `INSERT INTO products (category_id, product_name, description, price, stock, image, status, weight_grams, audience)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [category_id || null, product_name, description || null, price, stock || 0, image || null, finalStatus, weight, who]
      );
    }

    if (staffMember) {
      await addNotification({ type: 'product_approval', title: 'Product waiting for approval', message: `"${product_name}" was added by ${adminLabel(req)}`, ref_text: product_name, product_id: result.insertId });
    }
    // (the answer is built last, so nothing the admin sent can pretend to be the approval or the status)
    res.status(201).json({
      ...req.body,
      product_id: result.insertId,
      status: finalStatus,
      approval_status: staffMember ? 'pending' : 'approved',
      message: staffMember ? 'The product was saved. It is waiting for a Super Admin to approve it before customers can see it.' : 'Product added.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// PUT /api/products/:id - i-update ang isang product
app.put('/api/products/:id', verifyToken, requirePermission('products'), track('product.update', { lookup: lookupProductName, describe: (req, name) => (name ? `Edited the product "${name}"` : null), entity: (req) => ['product', Number(req.params.id)] }), async (req, res) => {
  try {
    const { category_id, product_name, description, price, stock, image, status, weight_grams, audience } = req.body;

    const weight = weight_grams === undefined || weight_grams === '' || weight_grams === null ? null : Number(weight_grams);
    if (weight !== null && (!Number.isInteger(weight) || weight < 1 || weight > 50000)) {
      return res.status(400).json({ error: 'Weight must be a whole number of grams between 1 and 50,000.' });
    }

    const who = audience === undefined || audience === null || audience === '' ? null : audience;
    if (who !== null && !AUDIENCES.includes(who)) return res.status(400).json({ error: AUDIENCE_ERROR });

    // A product that is not approved yet cannot be made active by editing it.
    const approval = await getApproval(req.params.id);
    const notApproved = !!approval && approval.status !== 'approved';
    const finalStatus = notApproved ? 'inactive' : status;

    await pool.query(
      `UPDATE products
       SET category_id = ?, product_name = ?, description = ?, price = ?, stock = ?, image = ?, status = ?,
           weight_grams = COALESCE(?, weight_grams), audience = COALESCE(?, audience)
       WHERE product_id = ?`,
      [category_id || null, product_name, description || null, price, stock, image || null, finalStatus, weight, who, req.params.id]
    );

    // A staff member who changes a REJECTED product sends it for approval again
    if (approval && approval.status === 'rejected' && !isSuperAdmin(req)) {
      await pool.query("UPDATE products SET approval_status = 'pending', approval_note = NULL WHERE product_id = ?", [req.params.id]);
      await addNotification({ type: 'product_approval', title: 'Product waiting for approval', message: `"${product_name}" was changed and sent again by ${adminLabel(req)}`, ref_text: product_name, product_id: Number(req.params.id) });
      return res.json({ message: 'The product was sent for approval again.', approval_status: 'pending' });
    }

    res.json({ message: 'Product updated.', approval_status: approval ? approval.status : 'approved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// DELETE /api/products/:id
// Changes only the status and / or the audience of a product (the dropdowns in the Products table)
app.put('/api/products/:id/quick', verifyToken, requirePermission('products'), track('product.status', { lookup: lookupProductName, describe: (req, name) => (name ? (req.body.status ? `Set "${name}" to ${req.body.status}` : `Changed who "${name}" is for to ${req.body.audience}`) : null), entity: (req) => ['product', Number(req.params.id)] }), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid product.' });
    const body = req.body || {};
    const status = body.status === undefined ? null : body.status;
    const audience = body.audience === undefined ? null : body.audience;
    if (status === null && audience === null) return res.status(400).json({ error: 'Nothing to change.' });
    if (status !== null && !['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'The status must be active or inactive.' });
    if (audience !== null && !AUDIENCES.includes(audience)) return res.status(400).json({ error: AUDIENCE_ERROR });

    const [found] = await pool.query('SELECT product_id FROM products WHERE product_id = ?', [id]);
    if (found.length === 0) return res.status(404).json({ error: 'Product not found.' });

    const approval = await getApproval(id);
    if (status === 'active' && approval && approval.status !== 'approved') {
      return res.status(400).json({ error: 'This product has to be approved by a Super Admin first.' });
    }

    await pool.query('UPDATE products SET status = COALESCE(?, status), audience = COALESCE(?, audience) WHERE product_id = ?', [status, audience, id]);
    res.json({ message: 'Product updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// The Super Admin approves a product (it becomes active, and customers can see and buy it) or rejects it (with a reason).
app.put('/api/products/:id/approval', verifyToken, requirePermission('products'), track(
  (req) => (req.body && req.body.decision === 'approve' ? 'product.approve' : 'product.reject'),
  {
    lookup: lookupProductName,
    describe: (req, name) => (name ? (req.body.decision === 'approve' ? `Approved the product "${name}"` : `Rejected the product "${name}": ${req.body.reason}`) : null),
    entity: (req) => ['product', Number(req.params.id)],
  }), async (req, res) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Only a Super Admin can approve or reject products.' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid product.' });
    const decision = (req.body || {}).decision;
    const reason = String((req.body || {}).reason || '');
    if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Please choose to approve or reject the product.' });
    if (decision === 'reject' && !REJECT_REASONS.includes(reason)) return res.status(400).json({ error: 'Please choose a reason for rejecting the product.' });

    let rows;
    try {
      [rows] = await pool.query('SELECT product_name, approval_status FROM products WHERE product_id = ?', [id]);
    } catch (err) {
      if (isMissingColumn(err)) return res.status(503).json({ error: APPROVAL_HINT });
      throw err;
    }
    if (rows.length === 0) return res.status(404).json({ error: 'Product not found.' });
    if (rows[0].approval_status !== 'pending') return res.status(400).json({ error: 'This product is not waiting for approval.' });

    const now = new Date();
    if (decision === 'approve') {
      await pool.query("UPDATE products SET approval_status = 'approved', status = 'active', approved_by = ?, approved_at = ?, approval_note = NULL WHERE product_id = ?", [req.admin.adminId, now, id]);
    } else {
      await pool.query("UPDATE products SET approval_status = 'rejected', status = 'inactive', approved_by = ?, approved_at = ?, approval_note = ? WHERE product_id = ?", [req.admin.adminId, now, reason, id]);
    }
    await addNotification({
      type: 'product_decision',
      title: decision === 'approve' ? 'Product approved' : 'Product rejected',
      message: decision === 'approve' ? `"${rows[0].product_name}" was approved by ${adminLabel(req)}` : `"${rows[0].product_name}" was rejected by ${adminLabel(req)}: ${reason}`,
      ref_text: rows[0].product_name, product_id: id,
    });
    res.json({ message: decision === 'approve' ? 'The product was approved. Customers can see it now.' : 'The product was rejected.', approval_status: decision === 'approve' ? 'approved' : 'rejected' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

app.delete('/api/products/:id', verifyToken, requirePermission('products'), track('product.delete', { lookup: lookupProductName, describe: (req, name) => (name ? `Deleted the product "${name}"` : null), entity: (req) => ['product', Number(req.params.id)] }), async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE product_id = ?', [req.params.id]);
    res.json({ message: 'Product deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// =====================================================
// REVIEWS MANAGEMENT (para sa ADMIN panel)
// =====================================================

// ---------- admin notifications (the bell). The table is shared with the order service. ----------
const LOW_STOCK_LIMIT = 10; // the same rule as the low stock list

async function addNotification(n) {
  try {
    await pool.query(
      'INSERT INTO admin_notifications (type, title, message, ref_text, product_id) VALUES (?, ?, ?, ?, ?)',
      [n.type, String(n.title).slice(0, 120), String(n.message).slice(0, 500), n.ref_text ? String(n.ref_text).slice(0, 150) : null, n.product_id || null]
    );
  } catch (err) {
    console.warn('Could not save the notification:', err.message); // never stops the main action
  }
}

async function notifyNewReview(productId, userId, stars, comment, mediaCount) {
  try {
    const [products] = await pool.query('SELECT product_name FROM products WHERE product_id = ?', [productId]);
    const [users] = await pool.query('SELECT full_name FROM users WHERE user_id = ?', [userId]);
    if (products.length === 0) return;
    const text = comment ? ` "${comment.length > 80 ? comment.slice(0, 77) + '...' : comment}"` : '';
    const files = mediaCount ? ` · with ${mediaCount} photo${mediaCount === 1 ? '' : 's'}/video` : '';
    await addNotification({
      type: 'new_review', title: `New review · ${products[0].product_name}`,
      message: `${users[0] ? users[0].full_name : 'A customer'} gave ${stars} star${stars === 1 ? '' : 's'}${text}${files}`,
      ref_text: products[0].product_name, product_id: productId,
    });
  } catch (err) {
    console.warn('Could not prepare the review notification:', err.message);
  }
}

async function notifyLowStock(productId) {
  try {
    const [rows] = await pool.query('SELECT product_id, product_name, stock FROM products WHERE product_id = ? AND stock < ?', [productId, LOW_STOCK_LIMIT]);
    if (rows.length === 0) return;
    const p = rows[0];
    const message = p.stock === 0 ? `${p.product_name} is out of stock` : `Only ${p.stock} left of ${p.product_name}`;
    const [recent] = await pool.query(
      "SELECT notification_id FROM admin_notifications WHERE type = 'low_stock' AND product_id = ? AND message = ? AND created_at > (NOW() - INTERVAL 1 DAY) LIMIT 1",
      [p.product_id, message]
    );
    if (recent.length === 0) await addNotification({ type: 'low_stock', title: `Low stock: ${p.product_name}`, message, ref_text: p.product_name, product_id: p.product_id });
  } catch (err) {
    console.warn('Could not check the low stock:', err.message);
  }
}

// Adds the photos and the video to each review in the list: review.media = [{ url, type }]
async function attachMedia(reviews) {
  if (reviews.length === 0) return reviews;
  const [media] = await pool.query(
    'SELECT review_id, media_url AS url, media_type AS type FROM review_media WHERE review_id IN (?) ORDER BY media_id',
    [reviews.map((r) => r.review_id)]
  );
  const byReview = new Map();
  for (const item of media) {
    if (!byReview.has(item.review_id)) byReview.set(item.review_id, []);
    byReview.get(item.review_id).push({ url: item.url, type: item.type });
  }
  return reviews.map((r) => ({ ...r, media: byReview.get(r.review_id) || [] }));
}

// GET /api/reviews - lahat ng reviews kasama pangalan ng product at customer (admin lang)
app.get('/api/reviews', verifyToken, requirePermission('reviews'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.*, p.product_name, u.full_name AS customer_name
      FROM reviews r
      LEFT JOIN products p ON r.product_id = p.product_id
      LEFT JOIN users u ON r.user_id = u.user_id
      ORDER BY r.created_at DESC
    `);
    res.json(await attachMedia(rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// PUT /api/reviews/:id/status - i-approve o i-hide ang isang review (admin lang)
app.put('/api/reviews/:id/status', verifyToken, requirePermission('reviews'), track(
  (req, before) => (req.body.status === 'hidden' ? 'review.hide' : before && before.status === 'pending' ? 'review.approve' : 'review.show'),
  {
    lookup: lookupReview,
    describe: (req, review) => {
      if (!review) return null;
      const verb = req.body.status === 'hidden' ? 'Hid' : review.status === 'pending' ? 'Approved' : 'Showed';
      return `${verb} the review of ${review.customer_name || 'a customer'} on "${review.product_name || 'a product'}"`;
    },
    entity: (req) => ['review', Number(req.params.id)],
  }), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'approved', 'hidden'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    const [found] = await pool.query('SELECT review_id FROM reviews WHERE review_id = ?', [req.params.id]);
    if (found.length === 0) return res.status(404).json({ error: 'Review not found.' });
    await pool.query('UPDATE reviews SET status = ? WHERE review_id = ?', [status, req.params.id]);
    res.json({ message: status === 'hidden' ? 'The review is now hidden.' : 'The review is now visible.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// DELETE /api/reviews/:id - permanenteng tanggalin ang isang review (admin lang)
app.delete('/api/reviews/:id', verifyToken, requirePermission('reviews'), track('review.delete', { lookup: lookupReview, describe: (req, review) => (review ? `Deleted the review of ${review.customer_name || 'a customer'} on "${review.product_name || 'a product'}"` : null), entity: (req) => ['review', Number(req.params.id)] }), async (req, res) => {
  try {
    await pool.query('DELETE FROM reviews WHERE review_id = ?', [req.params.id]);
    res.json({ message: 'Review deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// =====================================================
// REVIEWS - CUSTOMER-FACING (para sa MOBILE APP)
// =====================================================

// GET /api/products/:id/reviews - publiko, makikita lang ang mga APPROVED review
// (ginagamit ng ProductDetailScreen sa mobile app)
app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.review_id, r.rating, r.comment, r.created_at, u.full_name AS customer_name
      FROM reviews r
      LEFT JOIN users u ON r.user_id = u.user_id
      WHERE r.product_id = ? AND r.status = 'approved'
      ORDER BY r.created_at DESC
    `, [req.params.id]);
    res.json(await attachMedia(rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// GET /api/reviews/my?order_id=7 - the reviews the customer already wrote for one order
app.get('/api/reviews/my', verifyCustomerToken, async (req, res) => {
  try {
    const orderId = Number(req.query.order_id);
    if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ error: 'Invalid order.' });
    const [rows] = await pool.query(
      'SELECT review_id, product_id, rating, status FROM reviews WHERE user_id = ? AND order_id = ?',
      [req.customer.userId, orderId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// Only photos and videos that were uploaded to the shop's Cloudinary are accepted
const MEDIA_URL = /^https:\/\/res\.cloudinary\.com\/roit6yup\/(image|video)\/upload\/[A-Za-z0-9_\-./%,]+$/;
const MAX_REVIEW_PHOTOS = 5;
const MAX_REVIEW_VIDEOS = 1;

function checkReviewMedia(media) {
  if (media === undefined || media === null) return { items: [] };
  if (!Array.isArray(media)) return { error: 'The photos and video are not valid.' };
  const items = [];
  let photos = 0;
  let videos = 0;
  for (const entry of media) {
    const url = String((entry && entry.url) || '');
    const match = MEDIA_URL.exec(url);
    if (!match || url.length > 500 || match[1] !== (entry && entry.type)) return { error: 'One of the photos or videos is not valid.' };
    if (match[1] === 'image') photos++;
    else videos++;
    items.push({ url, type: match[1] });
  }
  if (photos > MAX_REVIEW_PHOTOS) return { error: `You can add up to ${MAX_REVIEW_PHOTOS} photos.` };
  if (videos > MAX_REVIEW_VIDEOS) return { error: `You can add only ${MAX_REVIEW_VIDEOS} video.` };
  return { items };
}

// POST /api/products/:id/reviews - a customer reviews an item of their own COMPLETED order (once).
// The review waits for the shop's approval before it appears on the product page.
app.post('/api/products/:id/reviews', verifyCustomerToken, async (req, res) => {
  const productId = Number(req.params.id);
  const body = req.body || {};
  const orderId = Number(body.order_id);
  const stars = Number(body.rating);
  const comment = String(body.comment || '').trim();

  if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ error: 'Please review the item from your order.' });
  }
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return res.status(400).json({ error: 'A rating from 1 to 5 is required.' });
  if (comment.length > 500) return res.status(400).json({ error: 'The review is too long (500 characters maximum).' });
  const media = checkReviewMedia(body.media);
  if (media.error) return res.status(400).json({ error: media.error });

  let conn;
  try {
    const [accounts] = await pool.query('SELECT account_status FROM users WHERE user_id = ?', [req.customer.userId]);
    if (accounts.length > 0 && accounts[0].account_status && accounts[0].account_status !== 'active') {
      return res.status(403).json({ error: 'Your account cannot post reviews right now. Please contact the shop.', code: 'ACCOUNT_BLOCKED' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [orders] = await conn.query(
      `SELECT o.status FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
       WHERE o.order_id = ? AND o.user_id = ? AND oi.product_id = ? LIMIT 1`,
      [orderId, req.customer.userId, productId]
    );
    if (orders.length === 0) {
      await conn.rollback();
      return res.status(403).json({ error: 'You can only review items from your own orders.' });
    }
    if (orders[0].status !== 'completed') {
      await conn.rollback();
      return res.status(400).json({ error: 'You can review an item after you confirm that you received the order.' });
    }
    const [existing] = await conn.query(
      'SELECT review_id FROM reviews WHERE user_id = ? AND order_id = ? AND product_id = ?',
      [req.customer.userId, orderId, productId]
    );
    if (existing.length > 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'You already reviewed this item.' });
    }

    const [result] = await conn.query(
      'INSERT INTO reviews (product_id, user_id, order_id, rating, comment, status) VALUES (?, ?, ?, ?, ?, ?)',
      [productId, req.customer.userId, orderId, stars, comment || null, 'pending']
    );
    for (const item of media.items) {
      await conn.query('INSERT INTO review_media (review_id, media_url, media_type) VALUES (?, ?, ?)', [result.insertId, item.url, item.type]);
    }
    await conn.commit();
    await notifyNewReview(productId, req.customer.userId, stars, comment, media.items.length);
    res.status(201).json({ review_id: result.insertId, message: 'Your review was submitted.' });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) { /* ignore */ } }
    if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'You already reviewed this item.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  } finally {
    if (conn) conn.release();
  }
});

// =====================================================
// PRODUCT IMAGES (gallery - harap/likod/gilid, atbp.)
// =====================================================

// GET /api/products/:id/images - publiko, kunin lahat ng larawan ng isang product
app.get('/api/products/:id/images', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM product_images WHERE product_id = ? ORDER BY display_order ASC, image_id ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// POST /api/products/:id/images - magdagdag ng bagong larawan sa gallery (admin lang)
app.post('/api/products/:id/images', verifyToken, requirePermission('products'), track('product.update', { lookup: lookupProductName, describe: (req, name) => (name ? `Added a photo to "${name}"` : null), entity: (req) => ['product', Number(req.params.id)] }), async (req, res) => {
  try {
    const { image_url } = req.body;
    if (!image_url) {
      return res.status(400).json({ error: 'image_url is required.' });
    }

    const [[{ maxOrder }]] = await pool.query(
      'SELECT COALESCE(MAX(display_order), -1) AS maxOrder FROM product_images WHERE product_id = ?',
      [req.params.id]
    );

    const [result] = await pool.query(
      'INSERT INTO product_images (product_id, image_url, display_order) VALUES (?, ?, ?)',
      [req.params.id, image_url, maxOrder + 1]
    );

    res.status(201).json({ image_id: result.insertId, product_id: req.params.id, image_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// DELETE /api/products/images/:imageId - tanggalin ang isang larawan sa gallery (admin lang)
app.delete('/api/products/images/:imageId', verifyToken, requirePermission('products'), track('product.update', { lookup: lookupImageProduct, describe: (req, name) => (name ? `Removed a photo of "${name}"` : null), entity: () => ['product', null] }), async (req, res) => {
  try {
    await pool.query('DELETE FROM product_images WHERE image_id = ?', [req.params.imageId]);
    res.json({ message: 'Image deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`Product service running sa http://localhost:${PORT}`);
});