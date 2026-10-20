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
    if (status === 'cancelled') {
      return res.status(400).json({ error: 'To cancel an order, use the Cancel order button. A reason is required and the stock is returned.' });
    }

    const [current] = await pool.query('SELECT status FROM orders WHERE order_id = ?', [req.params.id]);
    if (current.length === 0) return res.status(404).json({ error: 'Order not found.' });
    if (!(NEXT_STATUSES[current[0].status] || []).includes(status)) {
      return res.status(400).json({ error: `An order that is "${current[0].status}" cannot be changed to "${status}".` });
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

// =====================================================
// ORDER CANCELLATION
// =====================================================
const CUSTOMER_CANCEL_REASONS = [
  'I changed my mind',
  'I need to change my delivery address',
  'I ordered the wrong item or quantity',
  'I found a cheaper price elsewhere',
  'The payment is too troublesome',
  'Other',
];
const ADMIN_CANCEL_REASONS = [
  'Out of stock',
  'Customer asked to cancel',
  'Customer cannot be reached',
  'Payment problem',
  'Address problem',
  'Other',
];
const DECLINE_REASONS = [
  'The order is already packed',
  'The order is already with the courier',
  'Other',
];
// Which status changes are allowed (cancelling has its own route)
const NEXT_STATUSES = {
  pending: ['processing', 'shipped', 'completed'],
  processing: ['shipped', 'completed'],
  shipped: ['completed'],
  completed: [],
  cancelled: [],
};

// Cancels an order inside an open transaction: the stock goes back to the shelf.
async function cancelOrderInTransaction(conn, order, reason, by, adminId) {
  const [items] = await conn.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [order.order_id]);
  for (const item of items) {
    await conn.query('UPDATE products SET stock = stock + ? WHERE product_id = ?', [item.quantity, item.product_id]);
    try {
      await conn.query('INSERT INTO stock_logs (product_id, change_amount, reason, admin_id) VALUES (?, ?, ?, ?)', [
        item.product_id, item.quantity, `Order #${order.order_id} cancelled`, adminId || null,
      ]);
    } catch (err) {
      console.warn('Could not write the stock history:', err.code); // the stock itself is already corrected
    }
  }
  await conn.query(
    `UPDATE orders SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_at = NOW(), cancel_request_status = NULL
     WHERE order_id = ?`,
    [reason, by, order.order_id]
  );
}

// Runs a cancellation step inside a transaction. The reply is sent only AFTER the change is saved.
const fail = (status, error) => ({ ok: false, status, body: { error } });
const succeed = (body) => ({ ok: true, status: 200, body });

async function inTransaction(res, work) {
  let conn;
  let result;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    result = await work(conn);
    if (result.ok) await conn.commit();
    else await conn.rollback();
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) { /* ignore */ } }
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong on the server.' });
  } finally {
    if (conn) conn.release();
  }
  return res.status(result.status).json(result.body);
}

// CUSTOMER: pending orders cancel right away; processing orders need the seller's approval
app.put('/api/orders/my/:id/cancel', verifyCustomerToken, (req, res) => {
  const id = Number(req.params.id);
  const reason = String((req.body || {}).reason || '');
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid order.' });
  if (!CUSTOMER_CANCEL_REASONS.includes(reason)) return res.status(400).json({ error: 'Please choose a reason for cancelling.' });

  return inTransaction(res, async (conn) => {
    const [rows] = await conn.query('SELECT * FROM orders WHERE order_id = ? AND user_id = ? FOR UPDATE', [id, req.customer.userId]);
    if (rows.length === 0) return fail(404, 'Order not found.');
    const order = rows[0];

    if (order.status === 'pending') {
      await cancelOrderInTransaction(conn, order, reason, 'customer', null);
      return succeed({ cancelled: true, message: 'Your order has been cancelled.' });
    }
    if (order.status === 'processing') {
      if (order.cancel_request_status === 'requested') {
        return fail(400, 'You already asked to cancel this order. Please wait for the seller to reply.');
      }
      if (order.cancel_request_status === 'rejected') {
        return fail(400, 'The seller declined your cancellation request because the order is already being prepared.');
      }
      await conn.query(
        "UPDATE orders SET cancel_request_reason = ?, cancel_request_status = 'requested', cancel_request_at = NOW() WHERE order_id = ?",
        [reason, id]
      );
      return succeed({ cancelled: false, requested: true, message: 'Your cancellation request was sent. The seller will review it.' });
    }

    const messages = {
      shipped: 'This order is already on its way and cannot be cancelled. You can refuse the delivery or contact support.',
      completed: 'This order is already completed.',
      cancelled: 'This order is already cancelled.',
    };
    return fail(400, messages[order.status] || 'This order cannot be cancelled.');
  });
});

// ADMIN: cancel an order (for example when an item is out of stock)
app.put('/api/orders/:id/cancel', verifyToken, requirePermission('orders'), (req, res) => {
  const id = Number(req.params.id);
  const reason = String((req.body || {}).reason || '');
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid order.' });
  if (!ADMIN_CANCEL_REASONS.includes(reason)) return res.status(400).json({ error: 'Please choose a reason for cancelling.' });

  return inTransaction(res, async (conn) => {
    const [rows] = await conn.query('SELECT * FROM orders WHERE order_id = ? FOR UPDATE', [id]);
    if (rows.length === 0) return fail(404, 'Order not found.');
    if (rows[0].status === 'completed' || rows[0].status === 'cancelled') {
      return fail(400, `A ${rows[0].status} order cannot be cancelled.`);
    }
    await cancelOrderInTransaction(conn, rows[0], reason, 'admin', req.admin.adminId);
    return succeed({ message: 'The order was cancelled and the stock was returned.' });
  });
});

// ADMIN: approve or decline a customer's cancellation request
app.put('/api/orders/:id/cancel-request', verifyToken, requirePermission('orders'), (req, res) => {
  const id = Number(req.params.id);
  const decision = (req.body || {}).decision;
  const reason = String((req.body || {}).reason || '');
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid order.' });
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });
  if (decision === 'reject' && !DECLINE_REASONS.includes(reason)) return res.status(400).json({ error: 'Please choose a reason for declining.' });

  return inTransaction(res, async (conn) => {
    const [rows] = await conn.query('SELECT * FROM orders WHERE order_id = ? FOR UPDATE', [id]);
    if (rows.length === 0) return fail(404, 'Order not found.');
    const order = rows[0];
    if (order.cancel_request_status !== 'requested') {
      return fail(400, 'There is no pending cancellation request for this order.');
    }
    if (decision === 'approve') {
      await cancelOrderInTransaction(conn, order, order.cancel_request_reason || 'Customer asked to cancel', 'customer', req.admin.adminId);
      return succeed({ message: 'The cancellation was approved and the stock was returned.' });
    }
    await conn.query("UPDATE orders SET cancel_request_status = 'rejected', cancel_reject_reason = ? WHERE order_id = ?", [reason, id]);
    return succeed({ message: 'The cancellation request was declined.' });
  });
});

const PORT = process.env.PORT || 4002;
app.listen(PORT, () => {
  console.log(`Order service running sa http://localhost:${PORT}`);
});