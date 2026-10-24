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
    const [accounts] = await pool.query('SELECT email_verified, account_status, status_reason FROM users WHERE user_id = ?', [req.customer.userId]);
    if (accounts.length > 0 && accounts[0].account_status && accounts[0].account_status !== 'active') {
      const why = accounts[0].status_reason ? ` Reason: ${accounts[0].status_reason}.` : '';
      return res.status(403).json({ error: `Your account has been ${accounts[0].account_status === 'banned' ? 'banned' : 'suspended'}.${why} You cannot place orders. Please contact the shop.`, code: 'ACCOUNT_BLOCKED' });
    }
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

    // the order code: FG + the date + the order number, for example FG-261021-0014
    await conn.query("UPDATE orders SET order_code = CONCAT('FG-', DATE_FORMAT(order_date, '%y%m%d'), '-', LPAD(order_id, 4, '0')) WHERE order_id = ?", [orderId]);

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
        const session = await createCheckoutSession({ order_id: orderId, total_amount: totalAmount }, publicBaseUrl(req), cleanAppLink(body.app_return_url));
        await pool.query('UPDATE orders SET paymongo_session_id = ?, checkout_url = ? WHERE order_id = ?', [session.id, session.url, orderId]);
        checkoutUrl = session.url;
      } catch (err) {
        console.error('Could not open the GCash checkout:', err.message);
        paymentError = 'We could not open GCash right now. You can try again from your order.';
      }
    }

    // tell the admins (best effort: it never stops the order)
    await notifyOrder(orderId, 'new_order');
    await checkLowStock(cart.lines.map((line) => line.product_id));
    sendOrderEmail(orderId, 'placed'); // not waited for: the customer does not have to wait for the email
    const [codeRows] = await pool.query('SELECT order_code FROM orders WHERE order_id = ?', [orderId]);

    res.status(201).json({
      order_id: orderId,
      order_code: codeRows[0] ? codeRows[0].order_code : null,
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

// =====================================================
// MESSAGES: the chat between a customer and the shop
// (these routes are before "/api/orders/:id" on purpose, so that "messages" is not taken as an order number)
// =====================================================
const MESSAGE_MAX = 1000;
const MESSAGE_MIN_GAP_COUNT = 10; // a customer can send at most 10 messages in one minute
const NOT_READY = 'Messages are not ready yet. Run migration_messages.sql in MySQL Workbench first.';
const tableMissing = (err) => !!err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR');
const previewOf = (text) => (text.length > 110 ? text.slice(0, 110).trim() + '\u2026' : text);

function cleanMessage(raw) {
  const body = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!body) return { error: 'Please type a message.' };
  if (body.length > MESSAGE_MAX) return { error: `A message can have at most ${MESSAGE_MAX.toLocaleString('en-US')} letters.` };
  return { body };
}

async function lastMessages(threadId, limit) {
  const [rows] = await pool.query(
    'SELECT message_id, sender, admin_name, body, created_at FROM messages WHERE thread_id = ? ORDER BY message_id DESC LIMIT ?',
    [threadId, limit]
  );
  return rows.reverse();
}

// ----- the customer -----
// the numbers for the little badge of the app (how many replies of the shop were not read yet)
app.get('/api/orders/messages/my/unread', verifyCustomerToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT customer_unread FROM message_threads WHERE user_id = ?', [req.customer.userId]);
    res.json({ unread: rows[0] ? Number(rows[0].customer_unread) || 0 : 0 });
  } catch (err) {
    if (tableMissing(err)) return res.json({ unread: 0 });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// the conversation of the customer with the shop
app.get('/api/orders/messages/my', verifyCustomerToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT thread_id, customer_unread FROM message_threads WHERE user_id = ?', [req.customer.userId]);
    if (rows.length === 0) return res.json({ messages: [], unread: 0 });
    res.json({ messages: await lastMessages(rows[0].thread_id, 200), unread: Number(rows[0].customer_unread) || 0 });
  } catch (err) {
    if (tableMissing(err)) return res.status(503).json({ error: NOT_READY });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// the customer has opened the conversation: the replies are read
app.put('/api/orders/messages/my/read', verifyCustomerToken, async (req, res) => {
  try {
    await pool.query('UPDATE message_threads SET customer_unread = 0 WHERE user_id = ?', [req.customer.userId]);
    res.json({ unread: 0 });
  } catch (err) {
    if (tableMissing(err)) return res.json({ unread: 0 });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// the customer sends a message to the shop
app.post('/api/orders/messages/my', verifyCustomerToken, async (req, res) => {
  try {
    const cleaned = cleanMessage((req.body || {}).body);
    if (cleaned.error) return res.status(400).json({ error: cleaned.error });
    const userId = req.customer.userId;

    const [[recent]] = await pool.query(
      "SELECT COUNT(*) AS n FROM messages m JOIN message_threads t ON t.thread_id = m.thread_id WHERE t.user_id = ? AND m.sender = 'customer' AND m.created_at > ?",
      [userId, new Date(Date.now() - 60000)]
    );
    if (Number(recent.n) >= MESSAGE_MIN_GAP_COUNT) return res.status(429).json({ error: 'You are sending messages too fast. Please wait a moment.' });

    const now = new Date();
    let [threads] = await pool.query('SELECT thread_id, admin_unread FROM message_threads WHERE user_id = ?', [userId]);
    if (threads.length === 0) {
      try {
        await pool.query("INSERT INTO message_threads (user_id, last_message_at, last_preview, created_at) VALUES (?, ?, '', ?)", [userId, now, now]);
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err; // two messages at the same time: the other one made the conversation
      }
      [threads] = await pool.query('SELECT thread_id, admin_unread FROM message_threads WHERE user_id = ?', [userId]);
    }
    const thread = threads[0];
    const [added] = await pool.query("INSERT INTO messages (thread_id, sender, body, created_at) VALUES (?, 'customer', ?, ?)", [thread.thread_id, cleaned.body, now]);
    await pool.query('UPDATE message_threads SET last_message_at = ?, last_preview = ?, admin_unread = admin_unread + 1, customer_unread = 0 WHERE thread_id = ?', [now, previewOf(cleaned.body), thread.thread_id]);

    // the bell of the admins rings once for a conversation that was already read (not for every message)
    if (Number(thread.admin_unread) === 0) {
      const [people] = await pool.query('SELECT full_name FROM users WHERE user_id = ?', [userId]);
      const name = people[0] ? people[0].full_name : 'A customer';
      await addNotification({ type: 'new_message', title: 'New message', message: `${name}: "${previewOf(cleaned.body)}"`, ref_text: name });
    }
    res.status(201).json({ message: { message_id: added.insertId, sender: 'customer', admin_name: null, body: cleaned.body, created_at: now } });
  } catch (err) {
    if (tableMissing(err)) return res.status(503).json({ error: NOT_READY });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// ----- the admin (the Messages page) -----
const canSeeMessages = requireAnyPermission(['orders', 'customers']);

// how many messages of customers are waiting (the number for the Dashboard and the menu)
app.get('/api/orders/messages/unread-count', verifyToken, canSeeMessages, async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT COALESCE(SUM(admin_unread), 0) AS total FROM message_threads');
    res.json({ unread: Number(row.total) || 0 });
  } catch (err) {
    if (tableMissing(err)) return res.json({ unread: 0 });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// the list of the conversations, the newest first
app.get('/api/orders/messages', verifyToken, canSeeMessages, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT t.thread_id, t.user_id, t.last_message_at, t.last_preview, t.admin_unread,
              COALESCE(u.full_name, 'Deleted customer') AS customer_name, u.profile_photo
       FROM message_threads t
       LEFT JOIN users u ON u.user_id = t.user_id
       ORDER BY t.last_message_at DESC
       LIMIT 200`
    );
    res.json(rows.map((r) => ({ ...r, admin_unread: Number(r.admin_unread) || 0 })));
  } catch (err) {
    if (tableMissing(err)) return res.json([]);
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// one conversation (opening it marks the messages as read)
app.get('/api/orders/messages/:threadId', verifyToken, canSeeMessages, async (req, res) => {
  try {
    const threadId = Number(req.params.threadId);
    if (!Number.isInteger(threadId) || threadId <= 0) return res.status(400).json({ error: 'Invalid conversation.' });
    const [rows] = await pool.query(
      `SELECT t.thread_id, t.user_id, COALESCE(u.full_name, 'Deleted customer') AS customer_name, u.email, u.profile_photo
       FROM message_threads t LEFT JOIN users u ON u.user_id = t.user_id WHERE t.thread_id = ?`,
      [threadId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Conversation not found.' });
    const messages = await lastMessages(threadId, 300);
    await pool.query('UPDATE message_threads SET admin_unread = 0 WHERE thread_id = ?', [threadId]);
    res.json({ ...rows[0], messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// the shop answers
app.post('/api/orders/messages/:threadId', verifyToken, canSeeMessages, async (req, res) => {
  try {
    const threadId = Number(req.params.threadId);
    if (!Number.isInteger(threadId) || threadId <= 0) return res.status(400).json({ error: 'Invalid conversation.' });
    const cleaned = cleanMessage((req.body || {}).body);
    if (cleaned.error) return res.status(400).json({ error: cleaned.error });
    const [threads] = await pool.query('SELECT thread_id FROM message_threads WHERE thread_id = ?', [threadId]);
    if (threads.length === 0) return res.status(404).json({ error: 'Conversation not found.' });

    const now = new Date();
    const name = String(req.admin.fullName || req.admin.username || 'Fitora Gear').slice(0, 100);
    const [added] = await pool.query("INSERT INTO messages (thread_id, sender, admin_id, admin_name, body, created_at) VALUES (?, 'admin', ?, ?, ?, ?)", [threadId, req.admin.adminId || null, name, cleaned.body, now]);
    await pool.query('UPDATE message_threads SET last_message_at = ?, last_preview = ?, customer_unread = customer_unread + 1, admin_unread = 0 WHERE thread_id = ?', [now, previewOf(cleaned.body), threadId]);
    res.status(201).json({ message: { message_id: added.insertId, sender: 'admin', admin_name: name, body: cleaned.body, created_at: now } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
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

    // Every order also carries its items (name, how many, price, and the photo), so the app can show them in the list.
    // It is ONE extra question for all the orders (not one for each order).
    const byOrder = {};
    if (rows.length > 0) {
      const [items] = await pool.query(
        `SELECT oi.order_id, oi.product_id, oi.quantity, oi.price, p.product_name, p.image
         FROM order_items oi
         LEFT JOIN products p ON p.product_id = oi.product_id
         WHERE oi.order_id IN (?)
         ORDER BY oi.order_item_id`,
        [rows.map((o) => o.order_id)]
      );
      for (const item of items) (byOrder[item.order_id] = byOrder[item.order_id] || []).push(item);
    }
    res.json(rows.map((o) => ({ ...o, items: byOrder[o.order_id] || [] })));
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
      `SELECT oi.*, p.product_name, p.image FROM order_items oi
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
      SELECT o.*, u.full_name AS customer_name,
        (SELECT GROUP_CONCAT(CONCAT(oi.quantity, 'x ', p.product_name) ORDER BY oi.order_item_id SEPARATOR ', ')
         FROM order_items oi JOIN products p ON p.product_id = oi.product_id WHERE oi.order_id = o.order_id) AS items_summary
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
// ADMIN: all the orders of ONE customer (for the customer details window).
// Allowed for staff who can see customers OR orders.
function requireAnyPermission(keys) {
  return (req, res, next) => {
    if (req.admin.role === 'super_admin') return next();
    const permissions = req.admin.permissions || [];
    if (keys.some((key) => permissions.includes(key))) return next();
    return res.status(403).json({ error: 'You do not have access to this section.' });
  };
}

app.get('/api/orders/customer/:userId', verifyToken, requireAnyPermission(['customers', 'orders']), async (req, res) => {
  try {
    const id = Number(req.params.userId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid customer.' });
    const [rows] = await pool.query(
      `SELECT o.order_id, o.order_code, o.status, o.total_amount, o.order_date, o.payment_method, o.payment_status,
        (SELECT GROUP_CONCAT(CONCAT(oi.quantity, 'x ', p.product_name) ORDER BY oi.order_item_id SEPARATOR ', ')
         FROM order_items oi JOIN products p ON p.product_id = oi.product_id WHERE oi.order_id = o.order_id) AS items_summary
       FROM orders o WHERE o.user_id = ? ORDER BY o.order_date DESC LIMIT 100`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

app.get('/api/orders/:id', verifyToken, async (req, res) => {
  try {
    const [orderRows] = await pool.query(
      `SELECT o.*, u.full_name AS customer_name, u.email, u.phone AS customer_phone, u.profile_photo AS customer_photo
       FROM orders o LEFT JOIN users u ON o.user_id = u.user_id
       WHERE o.order_id = ?`,
      [req.params.id]
    );
    if (orderRows.length === 0) return res.status(404).json({ error: 'Order not found.' });

    const [itemRows] = await pool.query(
      `SELECT oi.*, p.product_name, p.image
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

const lookupOrderCode = async (req) => { const [r] = await pool.query('SELECT order_code FROM orders WHERE order_id = ?', [Number(req.params.id)]); return r[0] ? (r[0].order_code || '#' + Number(req.params.id)) : null; };
const orderEntity = (req) => ['order', Number(req.params.id)];

app.put('/api/orders/:id/status', verifyToken, requirePermission('orders'), track('order.status', { lookup: lookupOrderCode, describe: (req, code) => (code ? `Changed order ${code} to ${req.body.status}` : null), entity: orderEntity }), async (req, res) => {
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
    if (status === 'processing') sendOrderEmail(Number(req.params.id), 'processing');
    if (status === 'completed') sendOrderEmail(Number(req.params.id), 'completed');
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

// =====================================================
// SALES REPORT FOR A CHOSEN PERIOD (+ the CSV file of it)
// The days are the SHOP's days (Philippine time), not the database's. The orders of the period are read with
// a simple query and added up here, so the numbers can be checked and tested.
// Revenue = the value of the items of the orders that were NOT cancelled (the shipping fee is not included).
// =====================================================
const SHOP_UTC_OFFSET_HOURS = 8; // EDIT DITO: the Philippines is UTC+8. Reports group the days by this time.
const pad2 = (n) => String(n).padStart(2, '0');

function shopDateKey(date) {
  const d = new Date(new Date(date).getTime() + SHOP_UTC_OFFSET_HOURS * 3600000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function shopDateTime(date) {
  const d = new Date(new Date(date).getTime() + SHOP_UTC_OFFSET_HOURS * 3600000);
  return `${shopDateKey(date)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
function isRealDate(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key))) return false;
  const d = new Date(key + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === key;
}
function addDays(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(from, to) {
  return Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000) + 1;
}

// Reads ?from=YYYY-MM-DD&to=YYYY-MM-DD (without them: the last 7 days)
function reportRange(query) {
  let from = query && query.from;
  let to = query && query.to;
  if (!from && !to) {
    to = shopDateKey(Date.now());
    from = addDays(to, -6);
  }
  if (!isRealDate(from) || !isRealDate(to)) return { error: 'Please choose a valid start date and end date.' };
  if (from > to) return { error: 'The start date must not be after the end date.' };
  const days = daysBetween(from, to);
  if (days > 366) return { error: 'Please choose a period of at most 1 year.' };
  return { from, to, days };
}

// The orders (and their items) of the period. The query reads one day more on each side, because the
// database may keep its time differently; then only the orders that are really in the shop's days are kept.
async function loadReportData(range) {
  const start = `${addDays(range.from, -1)} 00:00:00`;
  const end = `${addDays(range.to, 2)} 00:00:00`;
  const [candidates] = await pool.query(
    `SELECT o.order_id, o.order_code, o.order_date, o.status, o.payment_method, o.payment_status, o.total_amount,
            o.subtotal_amount, o.shipping_fee, o.shipping_discount, o.courier, o.tracking_number, u.full_name AS customer_name
     FROM orders o LEFT JOIN users u ON u.user_id = o.user_id
     WHERE o.order_date >= ? AND o.order_date < ?
     ORDER BY o.order_date ASC, o.order_id ASC`,
    [start, end]
  );
  const orders = candidates.filter((o) => {
    const key = shopDateKey(o.order_date);
    return key >= range.from && key <= range.to;
  });
  if (orders.length === 0) return { orders, items: [] };
  const [rows] = await pool.query(
    `SELECT oi.order_id, oi.product_id, oi.quantity, oi.price, p.product_name, c.category_name
     FROM order_items oi
     JOIN orders o ON o.order_id = oi.order_id
     LEFT JOIN products p ON p.product_id = oi.product_id
     LEFT JOIN categories c ON c.category_id = p.category_id
     WHERE o.order_date >= ? AND o.order_date < ?
     ORDER BY oi.order_item_id`,
    [start, end]
  );
  const wanted = new Set(orders.map((o) => o.order_id));
  return { orders, items: rows.filter((i) => wanted.has(i.order_id)) };
}

const orderValue = (o) => Number(o.subtotal_amount != null ? o.subtotal_amount : o.total_amount) || 0;

function buildOverview(range, orders, items) {
  const counted = orders.filter((o) => o.status !== 'cancelled');
  const countedIds = new Set(counted.map((o) => o.order_id));
  const countedItems = items.filter((i) => countedIds.has(i.order_id));

  const revenue = counted.reduce((sum, o) => sum + orderValue(o), 0);
  const summary = {
    orders: counted.length,
    completedOrders: orders.filter((o) => o.status === 'completed').length,
    cancelledOrders: orders.length - counted.length,
    itemsSold: countedItems.reduce((sum, i) => sum + Number(i.quantity), 0),
    revenue: round2(revenue),
    avgOrderValue: counted.length ? round2(revenue / counted.length) : 0,
  };

  // one entry for every day of the period, even a day without sales
  const perDay = new Map();
  for (let i = 0; i < range.days; i++) perDay.set(addDays(range.from, i), { day: addDays(range.from, i), revenue: 0, orders: 0 });
  for (const o of counted) {
    const entry = perDay.get(shopDateKey(o.order_date));
    entry.revenue += orderValue(o);
    entry.orders += 1;
  }
  const byDay = [...perDay.values()].map((d) => ({ ...d, revenue: round2(d.revenue) }));

  const products = new Map();
  const categories = new Map();
  for (const i of countedItems) {
    const money = Number(i.quantity) * Number(i.price);
    const p = products.get(i.product_id) || { product_name: i.product_name || 'Removed product', totalSold: 0, totalRevenue: 0 };
    p.totalSold += Number(i.quantity);
    p.totalRevenue += money;
    products.set(i.product_id, p);
    const name = i.category_name || 'Uncategorized';
    categories.set(name, (categories.get(name) || 0) + money);
  }
  const bestSellers = [...products.values()]
    .sort((a, b) => b.totalSold - a.totalSold || b.totalRevenue - a.totalRevenue)
    .slice(0, 10)
    .map((p) => ({ ...p, totalRevenue: round2(p.totalRevenue) }));
  const byCategory = [...categories.entries()].map(([category_name, money]) => ({ category_name, revenue: round2(money) })).sort((a, b) => b.revenue - a.revenue);

  const payment = { cod: { method: 'cod', orders: 0, revenue: 0 }, gcash: { method: 'gcash', orders: 0, revenue: 0 } };
  for (const o of counted) {
    const entry = payment[o.payment_method === 'gcash' ? 'gcash' : 'cod'];
    entry.orders += 1;
    entry.revenue += orderValue(o);
  }
  const byPayment = Object.values(payment).map((p) => ({ ...p, revenue: round2(p.revenue) }));

  const byStatus = { pending: 0, processing: 0, shipped: 0, completed: 0, cancelled: 0 };
  for (const o of orders) if (o.status in byStatus) byStatus[o.status] += 1;

  return { range, summary, byDay, bestSellers, byCategory, byPayment, byStatus };
}

app.get('/api/orders/reports/overview', verifyToken, requirePermission('reports'), async (req, res) => {
  try {
    const range = reportRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    const { orders, items } = await loadReportData(range);
    res.json(buildOverview(range, orders, items));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// A cell of a CSV file. Text that Excel could read as a formula (it starts with = + - @) is made safe.
function csvText(value) {
  let text = String(value == null ? '' : value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
const csvNumber = (value) => (value == null || value === '' || Number.isNaN(Number(value)) ? '' : String(round2(Number(value))));
const PAYMENT_LABELS = { cod: 'Cash on Delivery', gcash: 'GCash' };
const PAYMENT_STATUS_LABELS = { unpaid: 'Unpaid', awaiting_payment: 'Awaiting payment', paid: 'Paid', refund_pending: 'Refund pending', refunded: 'Refunded' };

function buildOrdersCsv(orders, items) {
  const itemsByOrder = new Map();
  for (const i of items) {
    if (!itemsByOrder.has(i.order_id)) itemsByOrder.set(i.order_id, []);
    itemsByOrder.get(i.order_id).push(`${i.quantity}x ${i.product_name || 'Removed product'}`);
  }
  const lines = [['Order code', 'Date (shop time)', 'Customer', 'Items', 'Subtotal', 'Shipping fee', 'Shipping discount', 'Total', 'Payment method', 'Payment status', 'Order status', 'Courier', 'Tracking number'].join(',')];
  for (const o of orders) {
    lines.push([
      csvText(o.order_code || '#' + o.order_id),
      csvText(shopDateTime(o.order_date)),
      csvText(o.customer_name || ''),
      csvText((itemsByOrder.get(o.order_id) || []).join('; ')),
      csvNumber(o.subtotal_amount != null ? o.subtotal_amount : o.total_amount),
      csvNumber(o.shipping_fee),
      csvNumber(o.shipping_discount),
      csvNumber(o.total_amount),
      csvText(PAYMENT_LABELS[o.payment_method] || o.payment_method || ''),
      csvText(PAYMENT_STATUS_LABELS[o.payment_status] || o.payment_status || ''),
      csvText(o.status ? o.status.charAt(0).toUpperCase() + o.status.slice(1) : ''),
      csvText(o.courier || ''),
      csvText(o.tracking_number || ''),
    ].join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n'; // the first mark lets Excel read the peso sign and other letters correctly
}

app.get('/api/orders/reports/export', verifyToken, requirePermission('reports'), async (req, res) => {
  try {
    const range = reportRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    const { orders, items } = await loadReportData(range);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fitora-orders_${range.from}_to_${range.to}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buildOrdersCsv(orders, items));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

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
      SELECT c.category_name, COALESCE(SUM(CASE WHEN o.order_id IS NOT NULL AND o.status != 'cancelled' THEN oi.quantity * oi.price END), 0) AS revenue
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.category_id
      LEFT JOIN order_items oi ON oi.product_id = p.product_id
      LEFT JOIN orders o ON oi.order_id = o.order_id
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
      return { ...succeed({ cancelled: true, message: 'Your order has been cancelled.' }), after: () => Promise.all([expireCheckout(order.paymongo_session_id), afterCancelNotify(id, true, reason)]) };
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
      return { ...succeed({ cancelled: false, requested: true, message: 'Your cancellation request was sent. The seller will review it.' }), after: () => notifyOrder(id, 'cancel_request', reason) };
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
app.put('/api/orders/:id/cancel', verifyToken, requirePermission('orders'), track('order.cancel', { lookup: lookupOrderCode, describe: (req, code) => (code ? `Cancelled order ${code}${req.body.reason ? ': ' + req.body.reason : ''}` : null), entity: orderEntity }), (req, res) => {
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
    return { ...succeed({ message: 'The order was cancelled and the stock was returned.' }), after: () => Promise.all([expireCheckout(rows[0].paymongo_session_id), afterCancelNotify(id, false)]) };
  });
});

// ADMIN: approve or decline a customer's cancellation request
app.put('/api/orders/:id/cancel-request', verifyToken, requirePermission('orders'), track('order.cancel_request', { lookup: lookupOrderCode, describe: (req, code) => (code ? (req.body.decision === 'approve' ? `Approved the cancellation request of order ${code}` : `Declined the cancellation request of order ${code}${req.body.reason ? ': ' + req.body.reason : ''}`) : null), entity: orderEntity }), (req, res) => {
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
      return { ...succeed({ message: 'The cancellation was approved and the stock was returned.' }), after: () => Promise.all([expireCheckout(order.paymongo_session_id), afterCancelNotify(id, false)]) };
    }
    await conn.query("UPDATE orders SET cancel_request_status = 'rejected', cancel_reject_reason = ? WHERE order_id = ?", [reason, id]);
    return { ...succeed({ message: 'The cancellation request was declined.' }), after: () => sendOrderEmail(id, 'declined') };
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

// =====================================================
// EMAILS TO THE CUSTOMER: order received, being prepared, on its way, cancelled
// They are a bonus: if emailing is not set up, or the email fails, the order is NOT affected.
// =====================================================
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

async function loadOrderForEmail(orderId) {
  const [rows] = await pool.query(
    `SELECT o.order_id, o.order_code, o.status, o.total_amount, o.subtotal_amount, o.shipping_fee, o.shipping_discount,
            o.payment_method, o.payment_status, o.ship_name, o.ship_phone, o.ship_street, o.ship_barangay, o.ship_city,
            o.ship_province, o.ship_zip, o.courier, o.tracking_number, o.cancel_reason, o.cancelled_by, o.cancel_reject_reason,
            u.email, u.first_name, u.full_name
     FROM orders o JOIN users u ON u.user_id = o.user_id WHERE o.order_id = ?`,
    [orderId]
  );
  if (rows.length === 0 || !rows[0].email) return null;
  const [items] = await pool.query(
    `SELECT oi.quantity, oi.price, p.product_name
     FROM order_items oi LEFT JOIN products p ON p.product_id = oi.product_id
     WHERE oi.order_id = ? ORDER BY oi.order_item_id`,
    [orderId]
  );
  return { order: rows[0], items };
}

function emailItemsTable(items, order, withTotals) {
  const rows = items.map((i) => `<tr>
      <td style="padding:6px 0">${escapeHtml(i.product_name || 'Product')} <span style="color:#888">x ${Number(i.quantity)}</span></td>
      <td style="padding:6px 0;text-align:right;white-space:nowrap">${peso(Number(i.price) * Number(i.quantity))}</td></tr>`).join('');
  const totals = withTotals ? `
    <tr><td colspan="2" style="border-top:1px solid #eee;padding-top:8px"></td></tr>
    ${order.subtotal_amount != null ? `<tr><td style="color:#666;padding:2px 0">Subtotal</td><td style="text-align:right">${peso(order.subtotal_amount)}</td></tr>
    <tr><td style="color:#666;padding:2px 0">Shipping fee</td><td style="text-align:right">${peso(order.shipping_fee)}</td></tr>
    ${Number(order.shipping_discount) > 0 ? `<tr><td style="color:#666;padding:2px 0">Shipping discount</td><td style="text-align:right;color:#1e8e4f">-${peso(order.shipping_discount)}</td></tr>` : ''}` : ''}
    <tr><td style="padding:6px 0;font-weight:bold">Total</td><td style="text-align:right;font-weight:bold;font-size:17px;color:#FC408C">${peso(order.total_amount)}</td></tr>` : '';
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">${rows}${totals}</table>`;
}

function emailAddress(order) {
  const lines = [order.ship_name, order.ship_street, order.ship_barangay ? 'Brgy. ' + order.ship_barangay : '',
    [order.ship_city, order.ship_province, order.ship_zip].filter(Boolean).join(', ')].filter(Boolean);
  return lines.map(escapeHtml).join('<br>');
}

// Writes the subject and the message for each kind of email
function buildOrderEmail(kind, order, items) {
  const code = order.order_code || '#' + order.order_id;
  const name = escapeHtml(order.first_name || order.full_name || 'there');
  const place = [order.ship_city, order.ship_province].filter(Boolean).join(', ');
  let subject;
  let heading;
  let body;

  if (kind === 'placed') {
    subject = `We received your order ${code}`;
    heading = 'Thank you for your order!';
    const payment = order.payment_method === 'gcash'
      ? (order.payment_status === 'paid'
        ? '<p>Payment: <b>GCash</b> (paid).</p>'
        : `<p style="background:#fff4e0;color:#7a4d0b;padding:12px 14px;border-radius:10px">Payment: <b>GCash</b>. Your order is <b>waiting for your payment</b>. Open the Fitora Gear app, go to <b>Orders</b>, choose this order, and tap <b>Pay with GCash</b> within ${PAYMENT_WINDOW_MINUTES} minutes. Unpaid orders are cancelled automatically.</p>`)
      : `<p>Payment: <b>Cash on Delivery</b>. Please prepare <b>${peso(order.total_amount)}</b> for the courier.</p>`;
    body = `<p>We received your order <b>${escapeHtml(code)}</b>.</p>${payment}${emailItemsTable(items, order, true)}
      <p style="margin:14px 0 4px"><b>Delivery address</b></p><p style="margin:0;color:#444;line-height:1.5">${emailAddress(order)}</p>
      <p style="color:#666;font-size:13px;margin-top:16px">We will email you again when your order is being prepared and when it is on its way.</p>`;
  } else if (kind === 'processing') {
    subject = `Your order ${code} is being prepared`;
    heading = 'We are preparing your order';
    body = `<p>Good news! The shop is now preparing your order <b>${escapeHtml(code)}</b>.</p>${emailItemsTable(items, order, false)}
      <p style="color:#666;font-size:13px">We will email you the courier and the tracking number as soon as it is on its way.</p>`;
  } else if (kind === 'shipped') {
    subject = `Your order ${code} is on its way`;
    heading = 'Your order is on its way!';
    const tracking = order.tracking_number
      ? `<p>Tracking number: <b style="font-size:18px;letter-spacing:1px">${escapeHtml(order.tracking_number)}</b></p>` : '';
    body = `<p>Good news! Your order <b>${escapeHtml(code)}</b> is on its way${place ? ' to ' + escapeHtml(place) : ''}.</p>
      <p>Courier: <b>${escapeHtml(order.courier || '-')}</b></p>${tracking}
      <p style="color:#666;font-size:13px">You can also see these details in the Fitora Gear app, under Orders. When your parcel arrives, tap "Order Received".</p>`;
  } else if (kind === 'declined') {
    subject = `Your cancellation request for ${code} was declined`;
    heading = 'We could not cancel your order';
    const why = order.cancel_reject_reason ? `<p>Reason: <b>${escapeHtml(order.cancel_reject_reason)}</b></p>` : '';
    body = `<p>The shop could not cancel your order <b>${escapeHtml(code)}</b>.</p>${why}
      <p>Your order will go on and will be delivered to you.</p>${emailItemsTable(items, order, false)}
      <p style="color:#666;font-size:13px">If you have questions, please contact the shop.</p>`;
  } else if (kind === 'completed') {
    subject = `Your order ${code} is complete`;
    heading = 'Thank you for shopping with us!';
    const paid = order.payment_method === 'gcash' ? 'Payment: paid with <b>GCash</b>.' : `Payment: <b>${peso(order.total_amount)}</b> paid in cash on delivery.`;
    body = `<p>Your order <b>${escapeHtml(code)}</b> is now complete. We hope you enjoy your items!</p><p>${paid}</p>${emailItemsTable(items, order, true)}
      <p style="background:#f7f3f7;padding:12px 14px;border-radius:10px;font-size:13.5px">Tell other shoppers what you think: open the Fitora Gear app, go to <b>Orders</b>, and tap <b>Rate this product</b> on this order. You can add photos and a video.</p>`;
  } else if (kind === 'payment') {
    subject = `We received your GCash payment for ${code}`;
    heading = 'Payment received';
    body = order.status === 'cancelled'
      ? `<p>We received your GCash payment of <b>${peso(order.total_amount)}</b>, but the order <b>${escapeHtml(code)}</b> was already cancelled.</p>
         <p style="background:#fff4e0;color:#7a4d0b;padding:12px 14px;border-radius:10px">The shop will refund your money. Please wait for the shop to process your refund.</p>${emailItemsTable(items, order, false)}`
      : `<p>We received your GCash payment of <b>${peso(order.total_amount)}</b> for order <b>${escapeHtml(code)}</b>. Thank you!</p>${emailItemsTable(items, order, false)}
         <p style="color:#666;font-size:13px">The shop will prepare your order soon. We will email you again when it is on its way.</p>`;
  } else if (kind === 'refunded') {
    subject = `Your refund for order ${code} was sent`;
    heading = 'Your refund was sent';
    body = `<p>The shop has refunded <b>${peso(order.total_amount)}</b> to your GCash account for the cancelled order <b>${escapeHtml(code)}</b>.</p>
      <p style="color:#666;font-size:13px">It may take some time to show up in your GCash. If you do not see it after a few days, please contact the shop.</p>`;
  } else {
    subject = `Your order ${code} was cancelled`;
    heading = 'Your order was cancelled';
    const who = order.cancelled_by === 'system'
      ? `This order was cancelled automatically because the GCash payment was not completed in ${PAYMENT_WINDOW_MINUTES} minutes.`
      : order.cancelled_by === 'admin' ? 'The shop cancelled this order.' : 'You cancelled this order.';
    const reason = order.cancelled_by !== 'system' && order.cancel_reason ? `<p>Reason: <b>${escapeHtml(order.cancel_reason)}</b></p>` : '';
    const money = order.payment_status === 'refund_pending'
      ? `<p style="background:#fff4e0;color:#7a4d0b;padding:12px 14px;border-radius:10px">You already paid <b>${peso(order.total_amount)}</b> with GCash. The shop will refund it to you. Please wait for the shop to process your refund.</p>`
      : order.payment_status === 'refunded' ? '<p>Your payment was refunded.</p>'
        : '<p>No payment was taken for this order.</p>';
    body = `<p>${escapeHtml(who)}</p>${reason}${money}${emailItemsTable(items, order, false)}
      <p style="color:#666;font-size:13px">You can order again anytime in the Fitora Gear app.</p>`;
  }

  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px;color:#222">
    <h2 style="color:#FC408C;margin:0 0 4px">Fitora Gear</h2>
    <h3 style="margin:0 0 14px">${escapeHtml(heading)}</h3>
    <p>Hi ${name},</p>${body}
  </div>`;
  return { subject, html };
}

// Sends one email about an order. It never throws, and it never stops what the shop is doing.
async function sendOrderEmail(orderId, kind) {
  try {
    if (!process.env.BREVO_API_KEY || !process.env.EMAIL_FROM) return;
    const loaded = await loadOrderForEmail(orderId);
    if (!loaded) return;
    const { subject, html } = buildOrderEmail(kind, loaded.order, loaded.items);
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: process.env.EMAIL_FROM_NAME || 'Fitora Gear', email: process.env.EMAIL_FROM },
        to: [{ email: loaded.order.email }],
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) console.warn(`The "${kind}" email of order #${orderId} was not sent:`, response.status);
  } catch (err) {
    console.warn(`The "${kind}" email of order #${orderId} was not sent:`, err.message);
  }
}

// ADMIN: mark an order as shipped with its courier and tracking number
app.put('/api/orders/:id/ship', verifyToken, requirePermission('orders'), track('order.ship', { lookup: lookupOrderCode, describe: (req, code) => (code ? `Shipped order ${code} via ${req.body.courier}${req.body.tracking_number ? ' (' + req.body.tracking_number + ')' : ''}` : null), entity: orderEntity }), (req, res) => {
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
      after: () => sendOrderEmail(id, 'shipped'),
    };
  });
});

// ADMIN: fix the courier or tracking number of an order that is already shipped
app.put('/api/orders/:id/shipping-info', verifyToken, requirePermission('orders'), track('order.ship', { lookup: lookupOrderCode, describe: (req, code) => (code ? `Changed the courier and tracking number of order ${code}` : null), entity: orderEntity }), (req, res) => {
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
    return { ...succeed({ message: 'Thank you! Your order is now completed.' }), after: () => sendOrderEmail(id, 'completed') };
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

// The address that opens the Fitora Gear app (the app sends it). Only the app's own kinds of address are
// accepted: never a normal web address, so nobody can use our page to send customers to another website.
function cleanAppLink(value) {
  if (typeof value !== 'string' || value.length > 300) return null;
  return /^(exp|exps|fitoragear):\/\/[^\s"'<>\\]+$/.test(value) ? value : null;
}

// One checkout page for one order, for the full amount (items + shipping - discount)
async function createCheckoutSession(order, baseUrl, appLink) {
  const back = appLink ? `&app=${encodeURIComponent(appLink)}` : '';
  const amount = Math.round(Number(order.total_amount) * 100); // PayMongo counts in centavos
  const data = await paymongo('POST', '/checkout_sessions', {
    data: {
      attributes: {
        line_items: [{ name: `Fitora Gear order #${order.order_id}`, quantity: 1, amount, currency: 'PHP' }],
        payment_method_types: ['gcash'],
        description: `Fitora Gear order #${order.order_id}`,
        reference_number: `FG-${order.order_id}`,
        success_url: `${baseUrl}/pay/success?order=${order.order_id}${back}`,
        cancel_url: `${baseUrl}/pay/cancelled?order=${order.order_id}${back}`,
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
    await notifyOrder(orderId, paymentStatus === 'paid' ? 'payment' : 'refund'); // the shop is told, too
    sendOrderEmail(orderId, 'payment'); // and the customer (this runs only once: a payment already saved returns above)
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
    // With a return link we open a fresh page: each checkout page is single-use, and an old page may point
    // to an old app session. Without one, the page that is already open is reused.
    const appLink = cleanAppLink(req.body && req.body.app_return_url);
    if (order.checkout_url && !appLink) return res.json({ payment_status: 'awaiting_payment', checkout_url: order.checkout_url });

    const previousSession = order.paymongo_session_id; // noted first, before it is replaced
    const session = await createCheckoutSession(order, publicBaseUrl(req), appLink);
    await pool.query('UPDATE orders SET paymongo_session_id = ?, checkout_url = ? WHERE order_id = ?', [session.id, session.url, id]);
    if (previousSession) await expireCheckout(previousSession); // the old page can no longer be paid
    res.json({ payment_status: 'awaiting_payment', checkout_url: session.url });
  } catch (err) {
    console.error('Could not open the GCash checkout:', err.message);
    res.status(502).json({ error: 'We could not open GCash right now. Please try again in a moment.' });
  }
});

// The page the customer sees after paying on the PayMongo page (it also confirms the payment)
function paymentPage({ ok, title, message, appLink }) {
  const back = appLink
    ? `<a class="back" href="${escapeHtml(appLink)}">Return to the Fitora Gear app</a>
<script>setTimeout(function () { window.location.href = ${JSON.stringify(appLink).replace(/</g, '\\u003c')}; }, 700);</script>`
    : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - Fitora Gear</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0d0d0d; font-family: Arial, sans-serif; padding: 20px; box-sizing: border-box; }
  .card { background: #fff; border-radius: 20px; max-width: 380px; width: 100%; padding: 32px 24px; text-align: center; }
  .mark { width: 72px; height: 72px; border-radius: 50%; background: ${ok ? '#fc408c' : '#f4a729'}; color: #fff; font-size: 40px; font-weight: bold; line-height: 72px; margin: 0 auto 16px; }
  h1 { font-size: 21px; margin: 0 0 8px; color: #111; } p { color: #666; font-size: 15px; line-height: 1.5; margin: 0; }
  .brand { margin-top: 22px; color: #fc408c; font-weight: bold; letter-spacing: 2px; font-size: 13px; }
  .back { display: block; margin-top: 22px; background: #fc408c; color: #fff; text-decoration: none; padding: 14px; border-radius: 12px; font-weight: bold; font-size: 15px; }
</style></head>
<body><div class="card"><div class="mark">${ok ? '✓' : '!'}</div><h1>${title}</h1><p>${message}</p>${back}<div class="brand">FITORA GEAR</div></div></body></html>`;
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
  const appLink = cleanAppLink(req.query.app);
  res.type('html').send(paymentPage(paid
    ? { ok: true, title: 'Payment received', message: 'Thank you! Your GCash payment was received. Taking you back to the Fitora Gear app...', appLink }
    : { ok: false, title: 'We are confirming your payment', message: 'Please go back to the Fitora Gear app. Your order will update in a moment.', appLink }));
});

app.get('/pay/cancelled', (req, res) => {
  res.type('html').send(paymentPage({
    ok: false,
    title: 'Payment not completed',
    message: `No money was taken. Go back to the Fitora Gear app and open your order to try again. Unpaid orders are cancelled after ${PAYMENT_WINDOW_MINUTES} minutes.`,
    appLink: cleanAppLink(req.query.app),
  }));
});

// ADMIN: the shop gave the money back (after refunding in the PayMongo dashboard), so mark it as done
app.put('/api/orders/:id/refunded', verifyToken, requirePermission('orders'), track('order.refund', { lookup: lookupOrderCode, describe: (req, code) => (code ? `Marked the refund of order ${code} as done` : null), entity: orderEntity }), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid order.' });
  return inTransaction(res, async (conn) => {
    const [rows] = await conn.query('SELECT * FROM orders WHERE order_id = ? FOR UPDATE', [id]);
    if (rows.length === 0) return fail(404, 'Order not found.');
    if (rows[0].payment_status !== 'refund_pending') return fail(400, 'This order has no refund waiting.');
    await conn.query("UPDATE orders SET payment_status = 'refunded', refunded_at = NOW() WHERE order_id = ?", [id]);
    return { ...succeed({ message: 'The refund was marked as done.' }), after: () => sendOrderEmail(id, 'refunded') };
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
  sendOrderEmail(orderId, 'cancelled'); // the customer is told it was cancelled automatically
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

// =====================================================
// ADMIN NOTIFICATIONS (the bell in the admin website)
// They are saved, so they stay even after the order was processed. Each admin has their own
// "read" marks: a notification glows until THAT admin opens it.
// =====================================================
const LOW_STOCK_LIMIT = 10; // the same rule as the low stock list: fewer than 10 left
const NOTIFICATION_PERMISSIONS = {
  new_order: 'orders', payment: 'orders', cancel_request: 'orders', order_cancelled: 'orders', refund: 'orders',
  low_stock: 'inventory', new_review: 'reviews',
  product_approval: 'products', product_decision: 'products', // "waiting for approval" is for the Super Admin only (see below)
  new_message: 'orders',
};

async function addNotification(n) {
  try {
    await pool.query(
      'INSERT INTO admin_notifications (type, title, message, ref_text, order_id, product_id) VALUES (?, ?, ?, ?, ?, ?)',
      [n.type, String(n.title).slice(0, 120), String(n.message).slice(0, 500), n.ref_text ? String(n.ref_text).slice(0, 150) : null, n.order_id || null, n.product_id || null]
    );
  } catch (err) {
    console.warn('Could not save the notification:', err.message); // a notification problem must never stop an order
  }
}

// Who ordered, what, how much, and how they pay
async function describeOrder(orderId) {
  const [rows] = await pool.query(
    `SELECT o.order_id, o.order_code, o.total_amount, o.payment_method, o.payment_status, u.full_name,
       (SELECT GROUP_CONCAT(CONCAT(oi.quantity, 'x ', p.product_name) ORDER BY oi.order_item_id SEPARATOR ', ')
        FROM order_items oi JOIN products p ON p.product_id = oi.product_id WHERE oi.order_id = o.order_id) AS items
     FROM orders o LEFT JOIN users u ON u.user_id = o.user_id WHERE o.order_id = ?`,
    [orderId]
  );
  return rows[0] || null;
}

async function notifyOrder(orderId, kind, extra) {
  try {
    const o = await describeOrder(orderId);
    if (!o) return;
    const code = o.order_code || `#${o.order_id}`;
    const who = o.full_name || 'A customer';
    const items = o.items || 'items';
    const total = '₱' + Number(o.total_amount).toLocaleString();
    const pay = o.payment_method === 'gcash' ? 'GCash' : 'Cash on Delivery';
    const texts = {
      new_order: [`New order ${code}`, `${who} ordered ${items} · ${total} · ${pay}${o.payment_status === 'awaiting_payment' ? ' (waiting for payment)' : ''}`],
      payment: [`Payment received · ${code}`, `${who} paid ${total} through GCash for ${items}`],
      cancel_request: [`Cancel request · ${code}`, `${who} wants to cancel${extra ? ` (${extra})` : ''}: ${items}`],
      order_cancelled: [`Order cancelled · ${code}`, `${who} cancelled ${items}${extra ? ` (${extra})` : ''}`],
      refund: [`Refund needed · ${code}`, `Refund ${total} to ${who} through GCash for the cancelled order: ${items}`],
    };
    if (!texts[kind]) return;
    await addNotification({ type: kind, title: texts[kind][0], message: texts[kind][1], ref_text: code, order_id: o.order_id });
  } catch (err) {
    console.warn('Could not prepare the notification:', err.message);
  }
}

// After an order was cancelled: tell the shop (if the customer did it) and remind about a refund
async function afterCancelNotify(orderId, announce, reason) {
  sendOrderEmail(orderId, 'cancelled'); // every way of cancelling an order (customer, shop, approved request) comes here
  const o = await describeOrder(orderId);
  if (!o) return;
  if (announce) await notifyOrder(orderId, 'order_cancelled', reason);
  if (o.payment_status === 'refund_pending') await notifyOrder(orderId, 'refund');
}

// A product that is running low (once for the same message in one day, so the bell is not spammed)
async function checkLowStock(productIds) {
  try {
    if (!productIds.length) return;
    const [rows] = await pool.query('SELECT product_id, product_name, stock FROM products WHERE product_id IN (?) AND stock < ?', [productIds, LOW_STOCK_LIMIT]);
    for (const p of rows) {
      const message = p.stock === 0 ? `${p.product_name} is out of stock` : `Only ${p.stock} left of ${p.product_name}`;
      const [recent] = await pool.query(
        "SELECT notification_id FROM admin_notifications WHERE type = 'low_stock' AND product_id = ? AND message = ? AND created_at > (NOW() - INTERVAL 1 DAY) LIMIT 1",
        [p.product_id, message]
      );
      if (recent.length > 0) continue;
      await addNotification({ type: 'low_stock', title: `Low stock: ${p.product_name}`, message, ref_text: p.product_name, product_id: p.product_id });
    }
  } catch (err) {
    console.warn('Could not check the low stock:', err.message);
  }
}

// Staff only see the notifications of the sections they have access to
function allowedNotificationTypes(admin) {
  const all = Object.keys(NOTIFICATION_PERMISSIONS);
  if (admin.role === 'super_admin') return all;
  const permissions = admin.permissions || [];
  return all
    .filter((type) => type !== 'product_approval') // only the Super Admin decides, so only the Super Admin is asked
    .filter((type) => permissions.includes(NOTIFICATION_PERMISSIONS[type]));
}

app.get('/api/notifications', verifyToken, async (req, res) => {
  try {
    const types = allowedNotificationTypes(req.admin);
    if (types.length === 0) return res.json({ unread: 0, items: [] });
    const [items] = await pool.query(
      `SELECT n.notification_id, n.type, n.title, n.message, n.ref_text, n.order_id, n.product_id, n.created_at,
              (r.admin_id IS NOT NULL) AS is_read
       FROM admin_notifications n
       LEFT JOIN admin_notification_reads r ON r.notification_id = n.notification_id AND r.admin_id = ?
       WHERE n.type IN (?) ORDER BY n.notification_id DESC LIMIT 40`,
      [req.admin.adminId, types]
    );
    const [counted] = await pool.query(
      `SELECT COUNT(*) AS unread FROM admin_notifications n
       LEFT JOIN admin_notification_reads r ON r.notification_id = n.notification_id AND r.admin_id = ?
       WHERE r.admin_id IS NULL AND n.type IN (?)`,
      [req.admin.adminId, types]
    );
    res.json({ unread: counted[0].unread, items: items.map((item) => ({ ...item, is_read: !!item.is_read })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

app.post('/api/notifications/read-all', verifyToken, async (req, res) => {
  try {
    const types = allowedNotificationTypes(req.admin);
    if (types.length > 0) {
      await pool.query(
        'INSERT IGNORE INTO admin_notification_reads (admin_id, notification_id) SELECT ?, n.notification_id FROM admin_notifications n WHERE n.type IN (?)',
        [req.admin.adminId, types]
      );
    }
    res.json({ message: 'All notifications were marked as read.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

app.post('/api/notifications/:id/read', verifyToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid notification.' });
    const [found] = await pool.query('SELECT notification_id FROM admin_notifications WHERE notification_id = ?', [id]);
    if (found.length === 0) return res.status(404).json({ error: 'Notification not found.' });
    await pool.query('INSERT IGNORE INTO admin_notification_reads (admin_id, notification_id) VALUES (?, ?)', [req.admin.adminId, id]);
    res.json({ message: 'Marked as read.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

const PORT = process.env.PORT || 4002;
app.listen(PORT, () => {
  console.log(`Order service running sa http://localhost:${PORT}`);
});