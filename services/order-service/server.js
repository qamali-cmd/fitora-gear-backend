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
// =====================================================
// SHIPPING FEE (by destination zone and parcel weight)
// The shop is in Lucena, Quezon. These are demo rates modeled on the zone and weight
// structure of public courier rates; they are not official courier prices.
// =====================================================
const SHIPPING_RATES = {            // [up to 0.5 kg, up to 1 kg, up to 3 kg] in pesos
  quezon: [65, 110, 140],
  luzon: [85, 155, 180],
  metro_manila: [95, 165, 190],
  visayas: [100, 180, 200],
  mindanao: [105, 195, 215],
  island: [115, 205, 230],
};
const ZONE_LABELS = {
  quezon: 'Quezon province', luzon: 'Luzon', metro_manila: 'Metro Manila',
  visayas: 'Visayas', mindanao: 'Mindanao', island: 'Island province',
};
const EXTRA_PER_KG = 35;              // pesos for every extra kilo above 3 kg
const FREE_SHIPPING_MIN = 1500;       // orders of this amount or more get a shipping discount
const FREE_SHIPPING_MAX_DISCOUNT = 100;

// Official region codes (PSGC)
const REGION_ZONES = {
  '130000000': 'metro_manila',
  '010000000': 'luzon', '020000000': 'luzon', '030000000': 'luzon', '040000000': 'luzon',
  '050000000': 'luzon', '140000000': 'luzon', '170000000': 'luzon',
  '060000000': 'visayas', '070000000': 'visayas', '080000000': 'visayas', '180000000': 'visayas',
  '090000000': 'mindanao', '100000000': 'mindanao', '110000000': 'mindanao',
  '120000000': 'mindanao', '150000000': 'mindanao', '160000000': 'mindanao',
};
// If the address was typed by hand (no region code), the region name is used instead
const REGION_NAME_ZONES = [
  [/ncr|national capital|metro manila/i, 'metro_manila'],
  [/ilocos|cagayan valley|central luzon|calabarzon|mimaropa|bicol|cordillera|\bcar\b|region\s*(i|ii|iii|iv-?a|iv-?b|v)\b/i, 'luzon'],
  [/visayas|negros|region\s*(vi|vii|viii)\b/i, 'visayas'],
  [/zamboanga|northern mindanao|davao|soccsksargen|caraga|barmm|bangsamoro|mindanao|region\s*(ix|x|xi|xii|xiii)\b/i, 'mindanao'],
];
const ISLAND_PROVINCES = [
  'batanes', 'catanduanes', 'marinduque', 'masbate', 'romblon', 'palawan', 'biliran',
  'siquijor', 'camiguin', 'dinagat islands', 'sulu', 'tawi-tawi', 'basilan',
];

function round2(value) {
  return Math.round(value * 100) / 100;
}

function shippingZone(address) {
  const province = String(address.province_name || '').trim().toLowerCase();
  const regionName = String(address.region_name || '');
  if (ISLAND_PROVINCES.includes(province)) return 'island';

  let zone = REGION_ZONES[String(address.region_code || '')];
  if (!zone) {
    for (const [pattern, name] of REGION_NAME_ZONES) {
      if (pattern.test(regionName)) { zone = name; break; }
    }
  }
  if (!zone) zone = 'luzon'; // places we cannot recognize use the Luzon rate
  if (zone === 'luzon' && province === 'quezon' && (String(address.region_code) === '040000000' || /calabarzon|region\s*iv-?a\b/i.test(regionName))) {
    zone = 'quezon';
  }
  return zone;
}

function shippingFeeFor(zone, weightGrams) {
  const [upToHalfKg, upToOneKg, upToThreeKg] = SHIPPING_RATES[zone];
  if (weightGrams <= 500) return upToHalfKg;
  if (weightGrams <= 1000) return upToOneKg;
  if (weightGrams <= 3000) return upToThreeKg;
  return upToThreeKg + Math.ceil((weightGrams - 3000) / 1000) * EXTRA_PER_KG;
}

function priceShipping(address, weightGrams, subtotal) {
  const zone = shippingZone(address);
  const fee = shippingFeeFor(zone, weightGrams);
  const discount = subtotal >= FREE_SHIPPING_MIN ? Math.min(fee, FREE_SHIPPING_MAX_DISCOUNT) : 0;
  return {
    zone,
    zone_label: ZONE_LABELS[zone],
    weight_grams: weightGrams,
    shipping_fee: fee,
    shipping_discount: discount,
    free_shipping_min: FREE_SHIPPING_MIN,
    free_shipping_max_discount: FREE_SHIPPING_MAX_DISCOUNT,
  };
}

// Checks the cart against the database (prices come from the database, never from the app).
// Returns { error, status } or { lines, subtotal, weight }.
async function priceCart(db, rawItems, lockRows) {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 50) {
    return { error: 'Your cart is empty or invalid.', status: 400 };
  }
  const wanted = new Map(); // product_id -> quantity (the same product listed twice is merged)
  for (const item of rawItems) {
    const productId = Number(item && item.product_id);
    const quantity = Number(item && item.quantity);
    if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity < 1) {
      return { error: 'Your cart contains an invalid item.', status: 400 };
    }
    const total = (wanted.get(productId) || 0) + quantity;
    if (total > 99) return { error: 'You can order at most 99 of the same product.', status: 400 };
    wanted.set(productId, total);
  }

  const lines = [];
  let subtotal = 0;
  let weight = 0;
  // Fixed order, so two checkouts at the same time cannot block each other
  for (const productId of [...wanted.keys()].sort((a, b) => a - b)) {
    const quantity = wanted.get(productId);
    const [rows] = await db.query(
      `SELECT product_id, product_name, price, stock, status, weight_grams FROM products WHERE product_id = ?${lockRows ? ' FOR UPDATE' : ''}`,
      [productId]
    );
    const product = rows[0];
    if (!product || product.status !== 'active') {
      return { error: 'A product in your cart is no longer available. Please review your cart.', status: 400 };
    }
    if (product.stock < quantity) {
      return { error: `Not enough stock for ${product.product_name}. Only ${product.stock} left.`, status: 400 };
    }
    const price = Number(product.price);
    subtotal += price * quantity;
    weight += (Number(product.weight_grams) || 300) * quantity;
    lines.push({ product_id: productId, quantity, price });
  }
  return { lines, subtotal: round2(subtotal), weight };
}

// Tells the app which payment methods can be used right now (GCash needs the PayMongo key)
app.get('/api/orders/payment-methods', (req, res) => {
  res.json({ cod: true, gcash: paymongoReady() });
});

// Shows the customer the shipping fee and total BEFORE they place the order
app.post('/api/orders/quote', verifyCustomerToken, async (req, res) => {
  try {
    const body = req.body || {};
    const addressId = Number(body.address_id);
    if (!Number.isInteger(addressId) || addressId <= 0) {
      return res.status(400).json({ error: 'Please choose a delivery address.' });
    }
    const [addressRows] = await pool.query('SELECT * FROM user_addresses WHERE address_id = ? AND user_id = ?', [addressId, req.customer.userId]);
    if (addressRows.length === 0) return res.status(400).json({ error: 'Please choose a valid delivery address.' });

    const cart = await priceCart(pool, body.items, false);
    if (cart.error) return res.status(cart.status).json({ error: cart.error });

    const shipping = priceShipping(addressRows[0], cart.weight, cart.subtotal);
    res.json({
      subtotal: cart.subtotal,
      ...shipping,
      total_amount: round2(cart.subtotal + shipping.shipping_fee - shipping.shipping_discount),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

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

  const body = req.body || {};
  const addressId = Number(body.address_id);
  if (!Number.isInteger(addressId) || addressId <= 0) {
    return res.status(400).json({ error: 'Please choose a delivery address.' });
  }

  const paymentMethod = body.payment_method === undefined ? 'cod' : body.payment_method;
  if (paymentMethod !== 'cod' && paymentMethod !== 'gcash') {
    return res.status(400).json({ error: 'Please choose how you want to pay.' });
  }
  if (paymentMethod === 'gcash' && !paymongoReady()) {
    return res.status(503).json({ error: 'GCash payment is not available right now. Please choose Cash on Delivery.', code: 'GCASH_UNAVAILABLE' });
  }
  await maybeExpireUnpaid(); // frees the stock of old unpaid GCash orders before checking the stock

  let conn;
  try {
    conn = await pool.getConnection();

    // A complete saved address is required: it also decides the shipping fee
    const [addressRows] = await conn.query('SELECT * FROM user_addresses WHERE address_id = ? AND user_id = ?', [addressId, req.customer.userId]);
    if (addressRows.length === 0) return res.status(400).json({ error: 'Please choose a valid delivery address.' });
    const ship = addressRows[0];
    const addressText = [ship.recipient_name, ship.phone, ship.street, 'Brgy. ' + ship.barangay_name, ship.city_name, ship.province_name, ship.region_name, ship.zip_code]
      .join(', ').slice(0, 250);

    await conn.beginTransaction();

    const cart = await priceCart(conn, body.items, true);
    if (cart.error) {
      await conn.rollback();
      return res.status(cart.status).json({ error: cart.error });
    }

    const shipping = priceShipping(ship, cart.weight, cart.subtotal);
    const totalAmount = round2(cart.subtotal + shipping.shipping_fee - shipping.shipping_discount);

    const [orderResult] = await conn.query(
      `INSERT INTO orders (user_id, total_amount, subtotal_amount, shipping_fee, shipping_discount, shipping_zone, total_weight_grams,
                           status, shipping_address, ship_name, ship_phone, ship_region, ship_province, ship_city, ship_barangay,
                           ship_street, ship_zip, ship_landmark, ship_region_code, ship_province_code, payment_method, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.customer.userId, totalAmount, cart.subtotal, shipping.shipping_fee, shipping.shipping_discount, shipping.zone, cart.weight,
        addressText, ship.recipient_name, ship.phone, ship.region_name, ship.province_name, ship.city_name, ship.barangay_name,
        ship.street, ship.zip_code, ship.landmark, ship.region_code, ship.province_code,
        paymentMethod, paymentMethod === 'gcash' ? 'awaiting_payment' : 'unpaid']
    );
    const orderId = orderResult.insertId;

    for (const line of cart.lines) {
      await conn.query('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)', [orderId, line.product_id, line.quantity, line.price]);
      await conn.query('UPDATE products SET stock = stock - ? WHERE product_id = ?', [line.quantity, line.product_id]);
    }

    await conn.commit();

    // GCash: open the PayMongo checkout page for this order. If that fails, the order still exists
    // and the customer can press "Pay with GCash" again from the order details.
    let checkoutUrl = null;
    let paymentError = null;
    if (paymentMethod === 'gcash') {
      try {
        const session = await createCheckoutSession({ order_id: orderId, total_amount: totalAmount }, publicBaseUrl(req));
        await pool.query('UPDATE orders SET paymongo_session_id = ?, checkout_url = ? WHERE order_id = ?', [session.id, session.url, orderId]);
        checkoutUrl = session.url;
      } catch (err) {
        console.error('Could not open the GCash checkout:', err.message);
        paymentError = 'We could not open GCash right now. You can try again from your order.';
      }
    }

    res.status(201).json({
      order_id: orderId,
      status: 'pending',
      subtotal: cart.subtotal,
      shipping_fee: shipping.shipping_fee,
      shipping_discount: shipping.shipping_discount,
      total_amount: totalAmount,
      payment_method: paymentMethod,
      payment_status: paymentMethod === 'gcash' ? 'awaiting_payment' : 'unpaid',
      checkout_url: checkoutUrl,
      payment_error: paymentError,
    });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) { /* ignore */ } }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/orders/my - lahat ng order ng naka-login na customer
app.get('/api/orders/my', verifyCustomerToken, async (req, res) => {
  try {
    await maybeExpireUnpaid();
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
    await maybeExpireUnpaid();
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
    if (status === 'shipped') {
      return res.status(400).json({ error: 'To ship an order, use the Ship order button so the courier and tracking number are saved.' });
    }

    const [current] = await pool.query('SELECT status, payment_method, payment_status FROM orders WHERE order_id = ?', [req.params.id]);
    if (current.length === 0) return res.status(404).json({ error: 'Order not found.' });
    if (!(NEXT_STATUSES[current[0].status] || []).includes(status)) {
      return res.status(400).json({ error: `An order that is "${current[0].status}" cannot be changed to "${status}".` });
    }
    if (current[0].payment_method === 'gcash' && current[0].payment_status !== 'paid') {
      return res.status(400).json({ error: 'This order is waiting for the GCash payment, so it cannot move forward yet.' });
    }

    await pool.query('UPDATE orders SET status = ? WHERE order_id = ?', [status, req.params.id]);
    if (status === 'completed') await markCashPaid(pool, req.params.id); // the courier collected the cash
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
      "SELECT COALESCE(SUM(COALESCE(subtotal_amount, total_amount)), 0) AS totalRevenue FROM orders WHERE status != 'cancelled'"
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
      "SELECT COALESCE(SUM(COALESCE(subtotal_amount, total_amount)), 0) AS totalRevenue FROM orders WHERE status != 'cancelled'"
    );
    const [[{ avgOrderValue }]] = await pool.query(
      "SELECT COALESCE(AVG(COALESCE(subtotal_amount, total_amount)), 0) AS avgOrderValue FROM orders WHERE status != 'cancelled'"
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
      SELECT DATE(order_date) AS day, COALESCE(SUM(COALESCE(subtotal_amount, total_amount)), 0) AS revenue
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
  // Money that was already paid must be given back; an unpaid GCash order simply becomes unpaid
  let paymentStatus = order.payment_status || 'unpaid';
  if (paymentStatus === 'paid' && order.payment_method === 'gcash') paymentStatus = 'refund_pending';
  else if (paymentStatus === 'awaiting_payment') paymentStatus = 'unpaid';
  await conn.query(
    `UPDATE orders SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_at = NOW(), cancel_request_status = NULL,
       payment_status = ?
     WHERE order_id = ?`,
    [reason, by, paymentStatus, order.order_id]
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
  res.status(result.status).json(result.body);
  if (result.ok && typeof result.after === 'function') {
    result.after().catch((err) => console.warn('Follow-up action failed:', err.message)); // never affects the reply
  }
  return undefined;
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
      return { ...succeed({ cancelled: true, message: 'Your order has been cancelled.' }), after: () => expireCheckout(order.paymongo_session_id) };
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
    return { ...succeed({ message: 'The order was cancelled and the stock was returned.' }), after: () => expireCheckout(rows[0].paymongo_session_id) };
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
      return { ...succeed({ message: 'The cancellation was approved and the stock was returned.' }), after: () => expireCheckout(order.paymongo_session_id) };
    }
    await conn.query("UPDATE orders SET cancel_request_status = 'rejected', cancel_reject_reason = ? WHERE order_id = ?", [reason, id]);
    return succeed({ message: 'The cancellation request was declined.' });
  });
});

// =====================================================
// SHIPPING DETAILS (courier + tracking number) AND "ORDER RECEIVED"
// =====================================================
const COURIERS = ['J&T Express', 'LBC Express', 'Flash Express', 'SPX Express', 'Ninja Van', 'Own rider / own delivery', 'Other'];
const OWN_DELIVERY = 'Own rider / own delivery'; // no tracking number needed

function parseShipping(body) {
  const courier = String(body.courier || '');
  const tracking = String(body.tracking_number || '').trim();
  if (!COURIERS.includes(courier)) return { error: 'Please choose the courier.' };
  if (courier === OWN_DELIVERY) {
    if (tracking && !/^[A-Za-z0-9 -]{3,40}$/.test(tracking)) return { error: 'The note can only have letters, numbers, spaces, and dashes (3-40 characters).' };
    return { data: { courier, tracking: tracking || null } };
  }
  if (!/^[A-Za-z0-9-]{6,40}$/.test(tracking)) return { error: 'Please enter the tracking number (6-40 letters, numbers, or dashes, no spaces).' };
  return { data: { courier, tracking } };
}

function escapeHtml(text) {
  return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Emails the customer that the order is on its way. This is a bonus: if the email is not set up
// or fails, the order is still marked as shipped.
async function sendShippedEmail(userId, orderId, order, shipping) {
  if (!process.env.BREVO_API_KEY || !process.env.EMAIL_FROM) return;
  const [rows] = await pool.query('SELECT email, first_name, full_name FROM users WHERE user_id = ?', [userId]);
  if (rows.length === 0 || !rows[0].email) return;

  const name = rows[0].first_name || rows[0].full_name || 'there';
  const place = [order.ship_city, order.ship_province].filter(Boolean).join(', ');
  const trackingLine = shipping.tracking ? `<p>Tracking number: <b style="font-size:18px;letter-spacing:1px">${escapeHtml(shipping.tracking)}</b></p>` : '';
  const html = `<div style="font-family:Arial,sans-serif;max-width:440px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
    <h2 style="color:#FC408C;margin:0 0 12px">Fitora Gear</h2>
    <p>Hi ${escapeHtml(name)},</p>
    <p>Good news! Your order <b>#${orderId}</b> is on its way${place ? ' to ' + escapeHtml(place) : ''}.</p>
    <p>Courier: <b>${escapeHtml(shipping.courier)}</b></p>
    ${trackingLine}
    <p style="color:#666;font-size:13px">You can also see these details in the Fitora Gear app, under Orders. When your parcel arrives, tap "Order Received".</p>
  </div>`;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
    body: JSON.stringify({
      sender: { name: process.env.EMAIL_FROM_NAME || 'Fitora Gear', email: process.env.EMAIL_FROM },
      to: [{ email: rows[0].email }],
      subject: `Your Fitora Gear order #${orderId} is on its way`,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) console.warn('The shipped email was not sent:', response.status);
}

// ADMIN: mark an order as shipped with its courier and tracking number
app.put('/api/orders/:id/ship', verifyToken, requirePermission('orders'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid order.' });
  const parsed = parseShipping(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  return inTransaction(res, async (conn) => {
    const [rows] = await conn.query('SELECT * FROM orders WHERE order_id = ? FOR UPDATE', [id]);
    if (rows.length === 0) return fail(404, 'Order not found.');
    const order = rows[0];
    if (order.status === 'shipped') return fail(400, 'This order is already shipped. Use Edit tracking to change the details.');
    if (order.status !== 'pending' && order.status !== 'processing') return fail(400, `A ${order.status} order cannot be shipped.`);
    if (order.cancel_request_status === 'requested') {
      return fail(400, 'The customer asked to cancel this order. Approve or decline the request first.');
    }
    if (order.payment_method === 'gcash' && order.payment_status !== 'paid') {
      return fail(400, 'This order is waiting for the GCash payment, so it cannot be shipped yet.');
    }
    await conn.query(
      "UPDATE orders SET status = 'shipped', courier = ?, tracking_number = ?, shipped_at = NOW() WHERE order_id = ?",
      [parsed.data.courier, parsed.data.tracking, id]
    );
    return {
      ...succeed({ message: 'The order was marked as shipped. The customer can now see the courier and tracking number.' }),
      after: () => sendShippedEmail(order.user_id, id, order, parsed.data),
    };
  });
});

// ADMIN: fix the courier or tracking number of an order that is already shipped
app.put('/api/orders/:id/shipping-info', verifyToken, requirePermission('orders'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid order.' });
  const parsed = parseShipping(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  return inTransaction(res, async (conn) => {
    const [rows] = await conn.query('SELECT * FROM orders WHERE order_id = ? FOR UPDATE', [id]);
    if (rows.length === 0) return fail(404, 'Order not found.');
    if (rows[0].status !== 'shipped') return fail(400, 'Only a shipped order has tracking details to edit.');
    await conn.query('UPDATE orders SET courier = ?, tracking_number = ? WHERE order_id = ?', [parsed.data.courier, parsed.data.tracking, id]);
    return succeed({ message: 'The shipping details were updated.' });
  });
});

// CUSTOMER: "Order Received" - the parcel arrived, so the order is completed
app.put('/api/orders/my/:id/received', verifyCustomerToken, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid order.' });

  return inTransaction(res, async (conn) => {
    const [rows] = await conn.query('SELECT * FROM orders WHERE order_id = ? AND user_id = ? FOR UPDATE', [id, req.customer.userId]);
    if (rows.length === 0) return fail(404, 'Order not found.');
    if (rows[0].status !== 'shipped') {
      return fail(400, rows[0].status === 'completed' ? 'You already confirmed that you received this order.' : 'You can confirm the delivery after the order has been shipped.');
    }
    await conn.query("UPDATE orders SET status = 'completed', received_at = NOW() WHERE order_id = ?", [id]);
    await markCashPaid(conn, id); // the courier collected the cash
    return succeed({ message: 'Thank you! Your order is now completed.' });
  });
});

// =====================================================
// PAYMENTS: Cash on Delivery, and GCash through PayMongo (test mode)
// Needs these settings on Render for the order service:
//   PAYMONGO_SECRET_KEY = your PayMongo secret key (starts with sk_test_)
//   PUBLIC_BASE_URL     = the address of this service, for example https://fitora-order-service.onrender.com
// =====================================================
const PAYMONGO_API = 'https://api.paymongo.com/v1';
const PAYMENT_WINDOW_MINUTES = 30; // an unpaid GCash order is cancelled after this time

function paymongoReady() {
  return !!process.env.PAYMONGO_SECRET_KEY;
}

function publicBaseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || `https://${req.get('host')}`).replace(/\/+$/, '');
}

// Talks to PayMongo with the secret key (the key is never written to the logs or sent to the app)
async function paymongo(method, path, body) {
  if (!paymongoReady()) throw new Error('GCash payment is not set up yet.');
  const response = await fetch(PAYMONGO_API + path, {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: 'Basic ' + Buffer.from(process.env.PAYMONGO_SECRET_KEY + ':').toString('base64'),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.errors && data.errors[0] && data.errors[0].detail;
    throw new Error(detail || `PayMongo answered with ${response.status}`);
  }
  return data;
}

// One checkout page for one order, for the full amount (items + shipping - discount)
async function createCheckoutSession(order, baseUrl) {
  const amount = Math.round(Number(order.total_amount) * 100); // PayMongo counts in centavos
  const data = await paymongo('POST', '/checkout_sessions', {
    data: {
      attributes: {
        line_items: [{ name: `Fitora Gear order #${order.order_id}`, quantity: 1, amount, currency: 'PHP' }],
        payment_method_types: ['gcash'],
        description: `Fitora Gear order #${order.order_id}`,
        reference_number: `FG-${order.order_id}`,
        success_url: `${baseUrl}/pay/success?order=${order.order_id}`,
        cancel_url: `${baseUrl}/pay/cancelled?order=${order.order_id}`,
        send_email_receipt: false,
        show_line_items: true,
      },
    },
  });
  return { id: data.data.id, url: data.data.attributes.checkout_url };
}

// A checkout page does not expire by itself, so we close it when the order is cancelled
async function expireCheckout(sessionId) {
  if (!sessionId || !paymongoReady()) return;
  try {
    await paymongo('POST', `/checkout_sessions/${sessionId}/expire`);
  } catch (err) {
    console.warn('Could not close the checkout page:', err.message);
  }
}

// A cash order is paid when the courier hands over the parcel and collects the money
async function markCashPaid(db, orderId) {
  await db.query(
    "UPDATE orders SET payment_status = 'paid', paid_at = NOW() WHERE order_id = ? AND payment_method = 'cod' AND payment_status = 'unpaid'",
    [orderId]
  );
}

// Saves a payment that PayMongo confirmed. If the order was already cancelled, the money must be given back.
async function markPaid(orderId, paymentId) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM orders WHERE order_id = ? FOR UPDATE', [orderId]);
    const order = rows[0];
    if (!order || ['paid', 'refund_pending', 'refunded'].includes(order.payment_status)) {
      await conn.rollback();
      return order ? { payment_status: order.payment_status, status: order.status } : null;
    }
    const paymentStatus = order.status === 'cancelled' ? 'refund_pending' : 'paid';
    await conn.query('UPDATE orders SET payment_status = ?, paid_at = NOW(), paymongo_payment_id = ? WHERE order_id = ?', [paymentStatus, paymentId, orderId]);
    await conn.commit();
    return { payment_status: paymentStatus, status: order.status };
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) { /* ignore */ } }
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

// Asks PayMongo if the GCash payment of this order was received (the app, the success page, and the
// cleanup job all use this, so a payment is never missed even if the customer never comes back)
async function verifyPayment(orderId) {
  const [rows] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [orderId]);
  const order = rows[0];
  if (!order) return null;
  const settled = ['paid', 'refund_pending', 'refunded'].includes(order.payment_status);
  if (order.payment_method !== 'gcash' || !order.paymongo_session_id || settled) {
    return { payment_status: order.payment_status, status: order.status };
  }
  const session = await paymongo('GET', `/checkout_sessions/${order.paymongo_session_id}`);
  const payments = (session.data && session.data.attributes && session.data.attributes.payments) || [];
  const expected = Math.round(Number(order.total_amount) * 100);
  const paid = payments.find((p) => p.attributes && p.attributes.status === 'paid' && Number(p.attributes.amount) === expected);
  if (!paid) return { payment_status: order.payment_status, status: order.status };
  return markPaid(orderId, paid.id);
}

// CUSTOMER: "has my GCash payment arrived?" (the app asks this when the customer comes back)
app.post('/api/orders/my/:id/payment/verify', verifyCustomerToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid order.' });
    const [rows] = await pool.query('SELECT order_id FROM orders WHERE order_id = ? AND user_id = ?', [id, req.customer.userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Order not found.' });
    res.json(await verifyPayment(id));
  } catch (err) {
    console.error('Payment check failed:', err.message);
    res.status(502).json({ error: 'We could not check the payment right now. Please try again in a moment.' });
  }
});

// CUSTOMER: "Pay with GCash" for an order that is still waiting for its payment
app.post('/api/orders/my/:id/pay', verifyCustomerToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid order.' });
    const [rows] = await pool.query('SELECT * FROM orders WHERE order_id = ? AND user_id = ?', [id, req.customer.userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Order not found.' });
    const order = rows[0];
    if (order.payment_method !== 'gcash' || order.status !== 'pending' || order.payment_status !== 'awaiting_payment') {
      return res.status(400).json({ error: 'This order does not need a GCash payment.' });
    }
    const checked = await verifyPayment(id); // maybe it was already paid
    if (checked && checked.payment_status === 'paid') return res.json({ payment_status: 'paid', checkout_url: null });
    if (order.checkout_url) return res.json({ payment_status: 'awaiting_payment', checkout_url: order.checkout_url });

    const session = await createCheckoutSession(order, publicBaseUrl(req));
    await pool.query('UPDATE orders SET paymongo_session_id = ?, checkout_url = ? WHERE order_id = ?', [session.id, session.url, id]);
    res.json({ payment_status: 'awaiting_payment', checkout_url: session.url });
  } catch (err) {
    console.error('Could not open the GCash checkout:', err.message);
    res.status(502).json({ error: 'We could not open GCash right now. Please try again in a moment.' });
  }
});

// The page the customer sees after paying on the PayMongo page (it also confirms the payment)
function paymentPage({ ok, title, message }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - Fitora Gear</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0d0d0d; font-family: Arial, sans-serif; padding: 20px; box-sizing: border-box; }
  .card { background: #fff; border-radius: 20px; max-width: 380px; width: 100%; padding: 32px 24px; text-align: center; }
  .mark { width: 72px; height: 72px; border-radius: 50%; background: ${ok ? '#fc408c' : '#f4a729'}; color: #fff; font-size: 40px; font-weight: bold; line-height: 72px; margin: 0 auto 16px; }
  h1 { font-size: 21px; margin: 0 0 8px; color: #111; } p { color: #666; font-size: 15px; line-height: 1.5; margin: 0; }
  .brand { margin-top: 22px; color: #fc408c; font-weight: bold; letter-spacing: 2px; font-size: 13px; }
</style></head>
<body><div class="card"><div class="mark">${ok ? '✓' : '!'}</div><h1>${title}</h1><p>${message}</p><div class="brand">FITORA GEAR</div></div></body></html>`;
}

app.get('/pay/success', async (req, res) => {
  const id = Number(req.query.order);
  let paid = false;
  if (Number.isInteger(id) && id > 0) {
    try {
      const result = await verifyPayment(id);
      paid = !!result && (result.payment_status === 'paid' || result.payment_status === 'refund_pending');
    } catch (err) {
      console.warn('Could not confirm the payment on the success page:', err.message);
    }
  }
  res.type('html').send(paymentPage(paid
    ? { ok: true, title: 'Payment received', message: 'Thank you! Your GCash payment was received. You can close this page and go back to the Fitora Gear app.' }
    : { ok: false, title: 'We are confirming your payment', message: 'Please go back to the Fitora Gear app. Your order will update in a moment.' }));
});

app.get('/pay/cancelled', (req, res) => {
  res.type('html').send(paymentPage({
    ok: false,
    title: 'Payment not completed',
    message: `No money was taken. Go back to the Fitora Gear app and open your order to try again. Unpaid orders are cancelled after ${PAYMENT_WINDOW_MINUTES} minutes.`,
  }));
});

// ADMIN: the shop gave the money back (after refunding in the PayMongo dashboard), so mark it as done
app.put('/api/orders/:id/refunded', verifyToken, requirePermission('orders'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid order.' });
  return inTransaction(res, async (conn) => {
    const [rows] = await conn.query('SELECT * FROM orders WHERE order_id = ? FOR UPDATE', [id]);
    if (rows.length === 0) return fail(404, 'Order not found.');
    if (rows[0].payment_status !== 'refund_pending') return fail(400, 'This order has no refund waiting.');
    await conn.query("UPDATE orders SET payment_status = 'refunded', refunded_at = NOW() WHERE order_id = ?", [id]);
    return succeed({ message: 'The refund was marked as done.' });
  });
});

// ---------- unpaid GCash orders are cancelled after 30 minutes and their stock goes back ----------
async function cancelUnpaidOrder(orderId) {
  let conn;
  let order;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM orders WHERE order_id = ? FOR UPDATE', [orderId]);
    order = rows[0];
    if (!order || order.status !== 'pending' || order.payment_status !== 'awaiting_payment') {
      await conn.rollback();
      return;
    }
    await cancelOrderInTransaction(conn, order, 'Payment was not completed in time', 'system', null);
    await conn.commit();
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) { /* ignore */ } }
    throw err;
  } finally {
    if (conn) conn.release();
  }
  await expireCheckout(order && order.paymongo_session_id);
}

async function expireUnpaidOrders() {
  const [stale] = await pool.query(
    "SELECT order_id FROM orders WHERE payment_method = 'gcash' AND payment_status = 'awaiting_payment' AND status = 'pending' AND order_date < (NOW() - INTERVAL ? MINUTE) ORDER BY order_id LIMIT 20",
    [PAYMENT_WINDOW_MINUTES]
  );
  for (const row of stale) {
    try {
      // maybe the customer paid but never came back: PayMongo knows
      const checked = await verifyPayment(row.order_id).catch(() => null);
      if (checked && checked.payment_status === 'paid') continue;
      await cancelUnpaidOrder(row.order_id);
    } catch (err) {
      console.warn(`Could not clean up order #${row.order_id}:`, err.message);
    }
  }
}

let lastExpiryRun = 0;
async function maybeExpireUnpaid() {
  if (Date.now() - lastExpiryRun < 60 * 1000) return; // at most once a minute
  lastExpiryRun = Date.now();
  try {
    await expireUnpaidOrders();
  } catch (err) {
    console.warn('The unpaid order cleanup failed:', err.message);
  }
}

const expiryTimer = setInterval(() => { maybeExpireUnpaid(); }, 5 * 60 * 1000);
if (expiryTimer.unref) expiryTimer.unref();

const PORT = process.env.PORT || 4002;
app.listen(PORT, () => {
  console.log(`Order service running sa http://localhost:${PORT}`);
});