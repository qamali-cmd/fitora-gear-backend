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
app.get('/api/categories', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM categories ORDER BY category_name');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// POST /api/categories - gumawa ng bagong category (kailangan naka-login)
app.post('/api/categories', verifyToken, requirePermission('categories'), async (req, res) => {
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
app.put('/api/categories/:id', verifyToken, requirePermission('categories'), async (req, res) => {
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
app.delete('/api/categories/:id', verifyToken, requirePermission('categories'), async (req, res) => {
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
    const [rows] = await pool.query(`
      SELECT p.*, c.category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.category_id
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// GET /api/products/low-stock - products na mababa na ang stock (halimbawa <10)
app.get('/api/products/low-stock', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT product_id, product_name, stock FROM products WHERE stock < 10 ORDER BY stock ASC'
    );
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
app.post('/api/products/:id/stock-adjustment', verifyToken, requirePermission('inventory'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { change_amount, reason } = req.body;
    const productId = req.params.id;

    if (!change_amount || !reason) {
      conn.release();
      return res.status(400).json({ error: 'change_amount and reason are required.' });
    }

    await conn.beginTransaction();

    const [[product]] = await conn.query('SELECT stock FROM products WHERE product_id = ? FOR UPDATE', [productId]);
    if (!product) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: 'Product not found.' });
    }

    const newStock = product.stock + parseInt(change_amount);
    if (newStock < 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: 'Stock cannot go below zero.' });
    }

    await conn.query('UPDATE products SET stock = ? WHERE product_id = ?', [newStock, productId]);
    await conn.query(
      'INSERT INTO stock_logs (product_id, change_amount, reason, admin_id) VALUES (?, ?, ?, ?)',
      [productId, change_amount, reason, req.admin.adminId]
    );

    await conn.commit();
    conn.release();

    res.json({ message: 'Stock updated.', newStock });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// GET /api/products/stock-logs/recent
app.get('/api/products/stock-logs/recent', verifyToken, requirePermission('inventory'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT sl.*, p.product_name, a.full_name AS admin_name
      FROM stock_logs sl
      LEFT JOIN products p ON sl.product_id = p.product_id
      LEFT JOIN admins a ON sl.admin_id = a.admin_id
      ORDER BY sl.created_at DESC
      LIMIT 20
    `);
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
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// POST /api/products - gumawa ng bagong product
app.post('/api/products', verifyToken, requirePermission('products'), async (req, res) => {
  try {
    const { category_id, product_name, description, price, stock, image, status, weight_grams } = req.body;

    if (!product_name || price == null) {
      return res.status(400).json({ error: 'Product name and price are required.' });
    }
    const weight = weight_grams === undefined || weight_grams === '' || weight_grams === null ? 300 : Number(weight_grams);
    if (!Number.isInteger(weight) || weight < 1 || weight > 50000) {
      return res.status(400).json({ error: 'Weight must be a whole number of grams between 1 and 50,000.' });
    }

    const [result] = await pool.query(
      `INSERT INTO products (category_id, product_name, description, price, stock, image, status, weight_grams)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [category_id || null, product_name, description || null, price, stock || 0, image || null, status || 'active', weight]
    );

    res.status(201).json({ product_id: result.insertId, ...req.body });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// PUT /api/products/:id - i-update ang isang product
app.put('/api/products/:id', verifyToken, requirePermission('products'), async (req, res) => {
  try {
    const { category_id, product_name, description, price, stock, image, status, weight_grams } = req.body;

    const weight = weight_grams === undefined || weight_grams === '' || weight_grams === null ? null : Number(weight_grams);
    if (weight !== null && (!Number.isInteger(weight) || weight < 1 || weight > 50000)) {
      return res.status(400).json({ error: 'Weight must be a whole number of grams between 1 and 50,000.' });
    }

    await pool.query(
      `UPDATE products
       SET category_id = ?, product_name = ?, description = ?, price = ?, stock = ?, image = ?, status = ?,
           weight_grams = COALESCE(?, weight_grams)
       WHERE product_id = ?`,
      [category_id || null, product_name, description || null, price, stock, image || null, status, weight, req.params.id]
    );

    res.json({ message: 'Product updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// DELETE /api/products/:id
app.delete('/api/products/:id', verifyToken, requirePermission('products'), async (req, res) => {
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
app.put('/api/reviews/:id/status', verifyToken, requirePermission('reviews'), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'approved', 'hidden'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    await pool.query('UPDATE reviews SET status = ? WHERE review_id = ?', [status, req.params.id]);
    res.json({ message: 'Review updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// DELETE /api/reviews/:id - permanenteng tanggalin ang isang review (admin lang)
app.delete('/api/reviews/:id', verifyToken, requirePermission('reviews'), async (req, res) => {
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
app.post('/api/products/:id/images', verifyToken, requirePermission('products'), async (req, res) => {
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
app.delete('/api/products/images/:imageId', verifyToken, requirePermission('products'), async (req, res) => {
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