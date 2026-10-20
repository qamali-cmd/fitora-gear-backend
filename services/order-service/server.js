// server.js - Order Service
// Ito ang API na hahawak ng ORDERS - kapwa para sa ADMIN at para sa CUSTOMER (mobile app).
// Tumatakbo ito sa http://localhost:4002

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { verifyToken, requirePermission, verifyCustomerToken } = require('./middleware');

const app = express();
app.use(cors());
app.use(express.json());

// =====================================================
// CUSTOMER-FACING ORDERS (para sa mobile app)
// MAHALAGA: nauna ito ilagay BAGO ang "/api/orders/:id" sa ibaba,
// dahil kung hindi, ang "/api/orders/my" ay masusukol ng ":id"
// pattern (ituturing na "my" ang isang id) - ito yung dating bug.
// =====================================================

// POST /api/orders/place - gumawa ng bagong order (mula sa cart ng customer)
app.post('/api/orders/place', verifyCustomerToken, async (req, res) => {
  // The customer must have a verified email before placing an order
  try {
    const [accounts] = await pool.query('SELECT email_verified FROM users WHERE user_id = ?', [req.customer.userId]);
    if (accounts.length === 0 || !accounts[0].email_verified) {
      return res.status(403).json({ error: 'Please verify your email before placing an order.', code: 'EMAIL_NOT_VERIFIED' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong on the server.' });
  }

  const conn = await pool.getConnection();
  try {
    const { items, shipping_address, address_id } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      conn.release();
      return res.status(400).json({ error: 'Your cart is empty.' });
    }

    // Delivery address: a saved address (address_id) is preferred; a plain text address still works
    let ship = null;
    let addressText = shipping_address || null;
    if (address_id) {
      const [addressRows] = await conn.query('SELECT * FROM user_addresses WHERE address_id = ? AND user_id = ?', [address_id, req.customer.userId]);
      if (addressRows.length === 0) {
        conn.release();
        return res.status(400).json({ error: 'Please choose a valid delivery address.' });
      }
      ship = addressRows[0];
      addressText = [ship.recipient_name, ship.phone, ship.street, 'Brgy. ' + ship.barangay_name, ship.city_name, ship.province_name, ship.region_name, ship.zip_code]
        .join(', ').slice(0, 250);
    }

    await conn.beginTransaction();

    let totalAmount = 0;
    const orderItemsData = [];

    for (const item of items) {
      const [[product]] = await conn.query(
        'SELECT product_id, price, stock, product_name FROM products WHERE product_id = ? FOR UPDATE',
        [item.product_id]
      );

      if (!product) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: `Product #${item.product_id} was not found.` });
      }
      if (product.stock < item.quantity) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: `Not enough stock for ${product.product_name}.` });
      }

      totalAmount += product.price * item.quantity;
      orderItemsData.push({ product_id: product.product_id, quantity: item.quantity, price: product.price });
    }

    const [orderResult] = await conn.query(
      `INSERT INTO orders (user_id, total_amount, status, shipping_address, ship_name, ship_phone, ship_region, ship_province,
                           ship_city, ship_barangay, ship_street, ship_zip, ship_landmark, ship_region_code, ship_province_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.customer.userId, totalAmount, 'pending', addressText,
        ship ? ship.recipient_name : null, ship ? ship.phone : null, ship ? ship.region_name : null, ship ? ship.province_name : null,
        ship ? ship.city_name : null, ship ? ship.barangay_name : null, ship ? ship.street : null, ship ? ship.zip_code : null,
        ship ? ship.landmark : null, ship ? ship.region_code : null, ship ? ship.province_code : null]
    );
    const orderId = orderResult.insertId;

    for (const item of orderItemsData) {
      await conn.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
        [orderId, item.product_id, item.quantity, item.price]
      );
      await conn.query('UPDATE products SET stock = stock - ? WHERE product_id = ?', [item.quantity, item.product_id]);
    }

    await conn.commit();
    conn.release();

    res.status(201).json({ order_id: orderId, total_amount: totalAmount, status: 'pending' });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// GET /api/orders/my - lahat ng order ng naka-login na customer
app.get('/api/orders/my', verifyCustomerToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY order_date DESC',
      [req.customer.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// GET /api/orders/my/:id - detalye ng isang order ng customer (kasama ang items)
app.get('/api/orders/my/:id', verifyCustomerToken, async (req, res) => {
  try {
    const [[order]] = await pool.query(
      'SELECT * FROM orders WHERE order_id = ? AND user_id = ?',
      [req.params.id, req.customer.userId]
    );
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    const [items] = await pool.query(
      `SELECT oi.*, p.product_name FROM order_items oi
       LEFT JOIN products p ON oi.product_id = p.product_id
       WHERE oi.order_id = ?`,
      [req.params.id]
    );

    res.json({ ...order, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// =====================================================
// ORDERS (ginagamit ng ADMIN panel)
// =====================================================

// GET /api/orders - kunin lahat ng orders (kasama pangalan ng customer)
app.get('/api/orders', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT o.*, u.full_name AS customer_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.user_id
      ORDER BY o.order_date DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// GET /api/orders/:id - detalye ng isang order kasama ang mga item nito (ADMIN)
app.get('/api/orders/:id', verifyToken, async (req, res) => {
  try {
    const [orderRows] = await pool.query(
      `SELECT o.*, u.full_name AS customer_name, u.email
       FROM orders o LEFT JOIN users u ON o.user_id = u.user_id
       WHERE o.order_id = ?`,
      [req.params.id]
    );
    if (orderRows.length === 0) return res.status(404).json({ error: 'Order not found.' });

    const [itemRows] = await pool.query(
      `SELECT oi.*, p.product_name
       FROM order_items oi LEFT JOIN products p ON oi.product_id = p.product_id
       WHERE oi.order_id = ?`,
      [req.params.id]
    );

    res.json({ ...orderRows[0], items: itemRows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// PUT /api/orders/:id/status - i-update ang status ng order (ADMIN)
app.put('/api/orders/:id/status', verifyToken, requirePermission('orders'), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'processing', 'shipped', 'completed', 'cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    await pool.query('UPDATE orders SET status = ? WHERE order_id = ?', [status, req.params.id]);
    res.json({ message: 'Order status updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// =====================================================
// DASHBOARD STATS (ginagamit ng lahat ng naka-login na admin)
// =====================================================
app.get('/api/orders/stats/summary', verifyToken, async (req, res) => {
  try {
    const [[{ totalOrders }]] = await pool.query('SELECT COUNT(*) AS totalOrders FROM orders');
    const [[{ pendingOrders }]] = await pool.query(
      "SELECT COUNT(*) AS pendingOrders FROM orders WHERE status = 'pending'"
    );
    const [[{ totalRevenue }]] = await pool.query(
      "SELECT COALESCE(SUM(total_amount), 0) AS totalRevenue FROM orders WHERE status != 'cancelled'"
    );

    res.json({ totalOrders, pendingOrders, totalRevenue });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// =====================================================
// SALES REPORTS
// =====================================================

app.get('/api/orders/reports/summary', verifyToken, requirePermission('reports'), async (req, res) => {
  try {
    const [[{ completedOrders }]] = await pool.query(
      "SELECT COUNT(*) AS completedOrders FROM orders WHERE status = 'completed'"
    );
    const [[{ totalRevenue }]] = await pool.query(
      "SELECT COALESCE(SUM(total_amount), 0) AS totalRevenue FROM orders WHERE status != 'cancelled'"
    );
    const [[{ avgOrderValue }]] = await pool.query(
      "SELECT COALESCE(AVG(total_amount), 0) AS avgOrderValue FROM orders WHERE status != 'cancelled'"
    );

    res.json({ completedOrders, totalRevenue, avgOrderValue });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

app.get('/api/orders/reports/sales-by-day', verifyToken, requirePermission('reports'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DATE(order_date) AS day, COALESCE(SUM(total_amount), 0) AS revenue
      FROM orders
      WHERE status != 'cancelled' AND order_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(order_date)
      ORDER BY day ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

app.get('/api/orders/reports/best-sellers', verifyToken, requirePermission('reports'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.product_name, SUM(oi.quantity) AS totalSold, SUM(oi.quantity * oi.price) AS totalRevenue
      FROM order_items oi
      JOIN products p ON oi.product_id = p.product_id
      JOIN orders o ON oi.order_id = o.order_id
      WHERE o.status != 'cancelled'
      GROUP BY oi.product_id, p.product_name
      ORDER BY totalSold DESC
      LIMIT 5
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

app.get('/api/orders/reports/by-category', verifyToken, requirePermission('reports'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.category_name, COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.category_id
      LEFT JOIN order_items oi ON oi.product_id = p.product_id
      LEFT JOIN orders o ON oi.order_id = o.order_id AND o.status != 'cancelled'
      GROUP BY c.category_id, c.category_name
      ORDER BY revenue DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

const PORT = process.env.PORT || 4002;
app.listen(PORT, () => {
  console.log(`Order service running sa http://localhost:${PORT}`);
});