/* =========================================================
   FITORA GEAR ADMIN - Vanilla JavaScript
   Walang external library - fetch() lang ang ginagamit para
   tumawag sa mga backend API (auth, product, order services).
   ========================================================= */

// ---------------------------------------------------------
// EDIT DITO: palitan ang mga URL na ito kapag na-deploy na
// ang mga backend services mo (hindi na localhost)
// ---------------------------------------------------------
const API = {
  AUTH: 'http://localhost:4000/api/auth',
  PRODUCTS: 'http://localhost:4001/api',
  ORDERS: 'http://localhost:4002/api',
};

// ---------------------------------------------------------
// Helper: kunin ang saved token, gamitin sa lahat ng
// protektadong request (products add/edit/delete, orders, etc.)
// ---------------------------------------------------------
function getToken() {
  return sessionStorage.getItem('fitora_token');
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + getToken(),
  };
}

// ===========================================================
// LOGIN
// ===========================================================
const loginScreen = document.getElementById('loginScreen');
const adminApp = document.getElementById('adminApp');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch(API.AUTH + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      loginError.textContent = data.error || 'Hindi ma-login.';
      return;
    }

    sessionStorage.setItem('fitora_token', data.token);
    sessionStorage.setItem('fitora_admin', JSON.stringify(data.admin));
    showApp();
  } catch (err) {
    loginError.textContent = 'Hindi ma-reach ang server. Siguraduhing tumatakbo ang auth-service (port 4000).';
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  sessionStorage.removeItem('fitora_token');
  sessionStorage.removeItem('fitora_admin');
  location.hash = '';
  location.reload();
});

function showApp() {
  loginScreen.classList.add('hidden');
  adminApp.classList.remove('hidden');

  const admin = JSON.parse(sessionStorage.getItem('fitora_admin') || '{}');
  document.getElementById('adminName').textContent = admin.fullName ? 'Hi, ' + admin.fullName : '';

  applyAccessControl(admin);
  navigateTo(location.hash.replace('#', '') || 'dashboard');
  loadCategories(); // kailangan agad ito para sa product form dropdown
  loadNotifications();

  // Auto-refresh ng notifications kada 15 segundo, para hindi na kailangang
  // i-refresh ang buong page para makita ang bagong low stock/pending order
  setInterval(loadNotifications, 15000);
}

// EDIT DITO: ito ang listahan ng mga "gated" na tabs (hindi kasama ang dashboard,
// dahil laging bukas ito sa lahat ng naka-login na admin)
const GATED_PAGES = ['products', 'categories', 'inventory', 'customers', 'orders', 'reports', 'reviews'];

// Sinasabi kung may access ang kasalukuyang admin sa isang page
// (super_admin = laging oo; staff = tinitignan sa permissions niya)
function hasAccess(page) {
  const admin = JSON.parse(sessionStorage.getItem('fitora_admin') || '{}');
  if (page === 'dashboard') return true;
  if (page === 'admins') return admin.role === 'super_admin';
  if (admin.role === 'super_admin') return true;
  return (admin.permissions || []).includes(page);
}

// Itinatago sa sidebar ang mga tabs na wala namang access ang admin na naka-login
function applyAccessControl(admin) {
  document.querySelectorAll('.nav-link').forEach(link => {
    const page = link.dataset.page;
    link.classList.toggle('hidden', !hasAccess(page));
  });
}

// Check kung naka-login na pagbukas ng page
if (getToken()) {
  showApp();
}

// ===========================================================
// MOBILE MENU TOGGLE
// ===========================================================
document.getElementById('menuToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ===========================================================
// NAVIGATION (SPA-style, gamit ang hash: #dashboard, #products, etc.)
// ===========================================================
const navLinks = document.querySelectorAll('.nav-link');
navLinks.forEach(link => {
  link.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open'); // isara sa mobile
  });
});

window.addEventListener('hashchange', () => {
  navigateTo(location.hash.replace('#', ''));
});

function navigateTo(page) {
  if (!page) page = 'dashboard';

  // Kahit tago sa sidebar ang isang tab, i-block pa rin natin kung direktang
  // pinasok gamit ang URL hash (hal. i-type #orders sa address bar)
  if (!hasAccess(page)) page = 'dashboard';

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  const linkEl = document.querySelector('.nav-link[data-page="' + page + '"]');
  if (!pageEl || !linkEl) page = 'dashboard';

  document.getElementById('page-' + page).classList.add('active');
  document.querySelector('.nav-link[data-page="' + page + '"]').classList.add('active');
  document.getElementById('pageTitle').textContent = page.charAt(0).toUpperCase() + page.slice(1);

  if (page === 'dashboard') loadDashboard();
  if (page === 'products') loadProducts();
  if (page === 'categories') loadCategories(true);
  if (page === 'inventory') loadInventory();
  if (page === 'customers') loadCustomers();
  if (page === 'orders') loadOrders();
  if (page === 'reports') loadReports();
  if (page === 'reviews') loadReviews();
  if (page === 'admins') loadAdmins();
}

// ===========================================================
// DASHBOARD
// ===========================================================
async function loadDashboard() {
  try {
    const [orderStats, products, lowStock, orders] = await Promise.all([
      fetch(API.ORDERS + '/orders/stats/summary', { headers: authHeaders() }).then(r => r.json()),
      fetch(API.PRODUCTS + '/products').then(r => r.json()),
      fetch(API.PRODUCTS + '/products/low-stock').then(r => r.json()),
      fetch(API.ORDERS + '/orders', { headers: authHeaders() }).then(r => r.json()),
    ]);

    document.getElementById('statTotalProducts').textContent = products.length;
    document.getElementById('statTotalOrders').textContent = orderStats.totalOrders;
    document.getElementById('statPendingOrders').textContent = orderStats.pendingOrders;
    document.getElementById('statRevenue').textContent = '₱' + Number(orderStats.totalRevenue).toLocaleString();

    const lowStockList = document.getElementById('lowStockList');
    lowStockList.innerHTML = lowStock.length
      ? lowStock.map(p => `<li><span>${p.product_name}</span><span>${p.stock} left</span></li>`).join('')
      : '<li>Wala pang mababang stock.</li>';

    const recentList = document.getElementById('recentOrdersList');
    recentList.innerHTML = orders.slice(0, 5).map(o =>
      `<li><span>Order #${o.order_id} - ${o.customer_name || 'N/A'}</span><span>₱${Number(o.total_amount).toLocaleString()}</span></li>`
    ).join('') || '<li>Wala pang orders.</li>';

  } catch (err) {
    console.error(err);
  }
}

// ===========================================================
// PRODUCTS
// ===========================================================
let allCategories = [];

async function loadCategories(renderTable) {
  try {
    const res = await fetch(API.PRODUCTS + '/categories');
    allCategories = await res.json();

    if (renderTable) {
      const tbody = document.getElementById('categoriesTableBody');
      tbody.innerHTML = allCategories.map(c => `
        <tr>
          <td>${c.category_name}</td>
          <td>${c.description || ''}</td>
          <td>
            <button class="icon-btn" onclick="openCategoryModal(${c.category_id})">Edit</button>
            <button class="icon-btn danger" onclick="deleteCategory(${c.category_id})">Delete</button>
          </td>
        </tr>
      `).join('') || '<tr><td colspan="3">Wala pang categories.</td></tr>';
    }
  } catch (err) {
    console.error(err);
  }
}

let allProductsList = [];

async function loadProducts() {
  const tbody = document.getElementById('productsTableBody');
  try {
    const res = await fetch(API.PRODUCTS + '/products');
    allProductsList = await res.json();
    populateProductCategoryFilter();
    renderProductsTable();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6">Hindi ma-reach ang product-service (port 4001).</td></tr>';
  }
}

function populateProductCategoryFilter() {
  const select = document.getElementById('productCategoryFilter');
  const current = select.value;
  select.innerHTML = '<option value="all">All categories</option>' +
    allCategories.map(c => `<option value="${c.category_id}">${c.category_name}</option>`).join('');
  select.value = current || 'all';
}

function renderProductsTable() {
  const tbody = document.getElementById('productsTableBody');
  const search = document.getElementById('productSearch').value.toLowerCase().trim();
  const categoryFilter = document.getElementById('productCategoryFilter').value;
  const sort = document.getElementById('productSort').value;

  let list = allProductsList.filter(p => {
    const matchesSearch = !search || p.product_name.toLowerCase().includes(search);
    const matchesCategory = categoryFilter === 'all' || String(p.category_id) === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  if (sort === 'price_asc') list = [...list].sort((a, b) => a.price - b.price);
  if (sort === 'price_desc') list = [...list].sort((a, b) => b.price - a.price);
  if (sort === 'stock_asc') list = [...list].sort((a, b) => a.stock - b.stock);
  if (sort === 'stock_desc') list = [...list].sort((a, b) => b.stock - a.stock);

  tbody.innerHTML = list.map(p => `
    <tr>
      <td>${p.product_name}</td>
      <td>${p.category_name || '-'}</td>
      <td>₱${Number(p.price).toLocaleString()}</td>
      <td>${p.stock}</td>
      <td><span class="badge badge-${p.status}">${p.status}</span></td>
      <td>
        <button class="icon-btn" onclick="openProductModal(${p.product_id})">Edit</button>
        <button class="icon-btn danger" onclick="deleteProduct(${p.product_id})">Delete</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6">Walang product na tumugma.</td></tr>';
}

document.getElementById('productSearch').addEventListener('input', renderProductsTable);
document.getElementById('productCategoryFilter').addEventListener('change', renderProductsTable);
document.getElementById('productSort').addEventListener('change', renderProductsTable);

async function deleteProduct(id) {
  if (!confirm('Sigurado ka bang gusto mong i-delete ang product na ito?')) return;
  await fetch(API.PRODUCTS + '/products/' + id, { method: 'DELETE', headers: authHeaders() });
  loadProducts();
}

async function deleteCategory(id) {
  if (!confirm('Sigurado ka bang gusto mong i-delete ang category na ito?')) return;
  await fetch(API.PRODUCTS + '/categories/' + id, { method: 'DELETE', headers: authHeaders() });
  loadCategories(true);
}

document.getElementById('addProductBtn').addEventListener('click', () => openProductModal(null));
document.getElementById('addCategoryBtn').addEventListener('click', () => openCategoryModal(null));

// ---------------- MODAL: PRODUCT ----------------
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalForm = document.getElementById('modalForm');

function closeModal() {
  modalOverlay.classList.add('hidden');
  modalForm.innerHTML = '';
}

async function openProductModal(productId) {
  let product = { product_name: '', category_id: '', price: '', stock: 0, status: 'active', description: '' };

  if (productId) {
    const res = await fetch(API.PRODUCTS + '/products/' + productId);
    product = await res.json();
    modalTitle.textContent = 'Edit product';
  } else {
    modalTitle.textContent = 'Add product';
  }

  const categoryOptions = allCategories.map(c =>
    `<option value="${c.category_id}" ${c.category_id === product.category_id ? 'selected' : ''}>${c.category_name}</option>`
  ).join('');

  modalForm.innerHTML = `
    <label>Product name</label>
    <input type="text" id="f_name" value="${product.product_name || ''}" required>

    <label>Category</label>
    <select id="f_category">
      <option value="">-- Walang category --</option>
      ${categoryOptions}
    </select>

    <label>Description</label>
    <textarea id="f_description" rows="2">${product.description || ''}</textarea>

    <label>Price (₱)</label>
    <input type="number" id="f_price" step="0.01" value="${product.price || ''}" required>

    <label>Stock</label>
    <input type="number" id="f_stock" value="${product.stock || 0}" required>

    <label>Status</label>
    <select id="f_status">
      <option value="active" ${product.status === 'active' ? 'selected' : ''}>Active</option>
      <option value="inactive" ${product.status === 'inactive' ? 'selected' : ''}>Inactive</option>
    </select>

    <div class="modal-actions">
      <button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button>
      <button type="submit" class="primary-btn">Save</button>
    </div>
  `;

  modalForm.onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      product_name: document.getElementById('f_name').value,
      category_id: document.getElementById('f_category').value || null,
      description: document.getElementById('f_description').value,
      price: parseFloat(document.getElementById('f_price').value),
      stock: parseInt(document.getElementById('f_stock').value),
      status: document.getElementById('f_status').value,
    };

    const url = productId ? API.PRODUCTS + '/products/' + productId : API.PRODUCTS + '/products';
    const method = productId ? 'PUT' : 'POST';

    await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
    closeModal();
    loadProducts();
  };

  modalOverlay.classList.remove('hidden');
}

// ---------------- MODAL: CATEGORY ----------------
async function openCategoryModal(categoryId) {
  let category = { category_name: '', description: '' };

  if (categoryId) {
    category = allCategories.find(c => c.category_id === categoryId) || category;
    modalTitle.textContent = 'Edit category';
  } else {
    modalTitle.textContent = 'Add category';
  }

  modalForm.innerHTML = `
    <label>Category name</label>
    <input type="text" id="f_cat_name" value="${category.category_name || ''}" required>

    <label>Description</label>
    <textarea id="f_cat_description" rows="2">${category.description || ''}</textarea>

    <div class="modal-actions">
      <button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button>
      <button type="submit" class="primary-btn">Save</button>
    </div>
  `;

  modalForm.onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      category_name: document.getElementById('f_cat_name').value,
      description: document.getElementById('f_cat_description').value,
    };

    const url = categoryId ? API.PRODUCTS + '/categories/' + categoryId : API.PRODUCTS + '/categories';
    const method = categoryId ? 'PUT' : 'POST';

    await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
    closeModal();
    loadCategories(true);
  };

  modalOverlay.classList.remove('hidden');
}

// Isara ang modal kapag kinlik sa labas nito
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

// ===========================================================
// INVENTORY MANAGEMENT
// ===========================================================
let allProductsForInventory = [];

async function loadInventory() {
  const tbody = document.getElementById('inventoryTableBody');
  try {
    const res = await fetch(API.PRODUCTS + '/products');
    allProductsForInventory = await res.json();
    renderInventoryTable();
    loadStockLogs();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4">Hindi ma-reach ang product-service (port 4001).</td></tr>';
  }
}

function renderInventoryTable() {
  const tbody = document.getElementById('inventoryTableBody');
  const filter = document.getElementById('inventoryFilter').value;

  let list = allProductsForInventory;
  if (filter === 'low') list = list.filter(p => p.stock < 10); // EDIT DITO: low-stock threshold

  tbody.innerHTML = list.map(p => `
    <tr>
      <td>${p.product_name}</td>
      <td>${p.category_name || '-'}</td>
      <td>${p.stock < 10 ? '<span class="badge badge-cancelled">' + p.stock + '</span>' : p.stock}</td>
      <td><button class="icon-btn" onclick="openStockModal(${p.product_id})">Adjust stock</button></td>
    </tr>
  `).join('') || '<tr><td colspan="4">Wala pang products.</td></tr>';
}

document.getElementById('inventoryFilter').addEventListener('change', renderInventoryTable);

async function loadStockLogs() {
  const list = document.getElementById('stockLogsList');
  try {
    const res = await fetch(API.PRODUCTS + '/products/stock-logs/recent', { headers: authHeaders() });
    const logs = await res.json();

    list.innerHTML = logs.map(l => {
      const sign = l.change_amount > 0 ? '+' : '';
      return `<li><span>${l.product_name} - ${l.reason}</span><span>${sign}${l.change_amount}</span></li>`;
    }).join('') || '<li>Wala pang stock changes.</li>';
  } catch (err) {
    list.innerHTML = '<li>Hindi ma-load ang stock logs.</li>';
  }
}

// ---------------- MODAL: STOCK ADJUSTMENT ----------------
function openStockModal(productId) {
  const product = allProductsForInventory.find(p => p.product_id === productId);
  modalTitle.textContent = 'Adjust stock - ' + product.product_name;

  modalForm.innerHTML = `
    <label>Current stock</label>
    <input type="text" value="${product.stock}" disabled>

    <label>Reason</label>
    <select id="f_reason">
      <option value="Restock">Restock (dagdag)</option>
      <option value="Damaged">Damaged goods (bawas)</option>
      <option value="Correction">Correction</option>
    </select>

    <label>Amount</label>
    <input type="number" id="f_amount" min="1" value="1" required>

    <div class="modal-actions">
      <button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button>
      <button type="submit" class="primary-btn">Save</button>
    </div>
  `;

  modalForm.onsubmit = async (e) => {
    e.preventDefault();
    const reason = document.getElementById('f_reason').value;
    const rawAmount = parseInt(document.getElementById('f_amount').value);
    // Restock = dagdag (+), Damaged = bawas (-), Correction = direktang ilagay ng admin ang sign
    const change_amount = reason === 'Damaged' ? -Math.abs(rawAmount) : rawAmount;

    const res = await fetch(API.PRODUCTS + '/products/' + productId + '/stock-adjustment', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ change_amount, reason }),
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'May error sa pag-adjust ng stock.');
      return;
    }

    closeModal();
    loadInventory();
    loadNotifications(); // agad i-refresh ang bell, baka nabago ang low-stock list
  };

  modalOverlay.classList.remove('hidden');
}

// ===========================================================
// ORDERS
// ===========================================================
async function loadOrders() {
  const tbody = document.getElementById('ordersTableBody');
  try {
    const res = await fetch(API.ORDERS + '/orders', { headers: authHeaders() });
    const orders = await res.json();

    tbody.innerHTML = orders.map(o => `
      <tr>
        <td>#${o.order_id}</td>
        <td>${o.customer_name || 'N/A'}</td>
        <td>₱${Number(o.total_amount).toLocaleString()}</td>
        <td>
          <select class="status-select" onchange="updateOrderStatus(${o.order_id}, this.value)">
            ${['pending','processing','shipped','completed','cancelled'].map(s =>
              `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`
            ).join('')}
          </select>
        </td>
        <td>${new Date(o.order_date).toLocaleDateString()}</td>
      </tr>
    `).join('') || '<tr><td colspan="5">Wala pang orders.</td></tr>';
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5">Hindi ma-reach ang order-service (port 4002).</td></tr>';
  }
}

async function updateOrderStatus(orderId, status) {
  await fetch(API.ORDERS + '/orders/' + orderId + '/status', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ status }),
  });
  loadNotifications(); // agad i-refresh ang bell, baka nabago ang bilang ng pending orders
}

// ===========================================================
// SALES REPORTS
// ===========================================================
async function loadReports() {
  try {
    const [summary, salesByDay, bestSellers, byCategory] = await Promise.all([
      fetch(API.ORDERS + '/orders/reports/summary', { headers: authHeaders() }).then(r => r.json()),
      fetch(API.ORDERS + '/orders/reports/sales-by-day', { headers: authHeaders() }).then(r => r.json()),
      fetch(API.ORDERS + '/orders/reports/best-sellers', { headers: authHeaders() }).then(r => r.json()),
      fetch(API.ORDERS + '/orders/reports/by-category', { headers: authHeaders() }).then(r => r.json()),
    ]);

    document.getElementById('reportCompletedOrders').textContent = summary.completedOrders;
    document.getElementById('reportTotalRevenue').textContent = '₱' + Number(summary.totalRevenue).toLocaleString();
    document.getElementById('reportAvgOrder').textContent = '₱' + Number(summary.avgOrderValue).toFixed(2);

    renderSalesChart(salesByDay);

    const bestList = document.getElementById('bestSellersList');
    bestList.innerHTML = bestSellers.map(p =>
      `<li><span>${p.product_name}</span><span>${p.totalSold} sold - ₱${Number(p.totalRevenue).toLocaleString()}</span></li>`
    ).join('') || '<li>Wala pang sales data.</li>';

    const catList = document.getElementById('categoryRevenueList');
    catList.innerHTML = byCategory.map(c =>
      `<li><span>${c.category_name}</span><span>₱${Number(c.revenue).toLocaleString()}</span></li>`
    ).join('') || '<li>Wala pang categories.</li>';

  } catch (err) {
    console.error(err);
  }
}

// Gumagawa ng simpleng bar chart gamit ang div height - walang chart library
function renderSalesChart(salesByDay) {
  const chart = document.getElementById('salesChart');

  // Punuan ang huling 7 araw kahit walang sales sa ibang araw (para consistent yung x-axis)
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().split('T')[0];
    const found = salesByDay.find(s => s.day.split('T')[0] === dayStr);
    days.push({
      label: d.toLocaleDateString('en-US', { weekday: 'short' }),
      revenue: found ? Number(found.revenue) : 0,
    });
  }

  const maxRevenue = Math.max(...days.map(d => d.revenue), 1); // hindi hahati sa zero

  chart.innerHTML = days.map(d => {
    const heightPct = Math.max((d.revenue / maxRevenue) * 100, 2);
    return `
      <div class="bar-col">
        <div class="bar-value">${d.revenue > 0 ? '₱' + d.revenue.toLocaleString() : ''}</div>
        <div class="bar" style="height:${heightPct}%"></div>
        <div class="bar-label">${d.label}</div>
      </div>
    `;
  }).join('');
}

// ===========================================================
// CUSTOMER MANAGEMENT
// ===========================================================
let allCustomers = [];

async function loadCustomers() {
  const tbody = document.getElementById('customersTableBody');
  try {
    const res = await fetch(API.AUTH + '/customers', { headers: authHeaders() });
    allCustomers = await res.json();
    renderCustomersTable();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6">Hindi ma-reach ang auth-service (port 4000).</td></tr>';
  }
}

function renderCustomersTable() {
  const tbody = document.getElementById('customersTableBody');
  const search = document.getElementById('customerSearch').value.toLowerCase().trim();

  const list = allCustomers.filter(c =>
    !search ||
    c.full_name.toLowerCase().includes(search) ||
    c.email.toLowerCase().includes(search)
  );

  tbody.innerHTML = list.map(c => `
    <tr>
      <td>${c.full_name}</td>
      <td>${c.email}</td>
      <td>${c.phone || '-'}</td>
      <td>${c.order_count}</td>
      <td><span class="badge badge-${c.is_active ? 'active' : 'inactive'}">${c.is_active ? 'active' : 'inactive'}</span></td>
      <td>
        <button class="icon-btn ${c.is_active ? 'danger' : ''}" onclick="toggleCustomerStatus(${c.user_id}, ${c.is_active ? 0 : 1})">
          ${c.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6">Wala pang customers na naka-register.</td></tr>';
}

document.getElementById('customerSearch').addEventListener('input', renderCustomersTable);

async function toggleCustomerStatus(userId, newStatus) {
  await fetch(API.AUTH + '/customers/' + userId + '/status', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ is_active: newStatus }),
  });
  loadCustomers();
}

// ===========================================================
// NOTIFICATIONS (bell icon - low stock + pending orders)
// ===========================================================
async function loadNotifications() {
  try {
    const [lowStock, orders] = await Promise.all([
      fetch(API.PRODUCTS + '/products/low-stock').then(r => r.json()),
      fetch(API.ORDERS + '/orders', { headers: authHeaders() }).then(r => r.json()),
    ]);

    const pendingOrders = orders.filter(o => o.status === 'pending');
    const total = lowStock.length + pendingOrders.length;

    const badge = document.getElementById('notifBadge');
    badge.textContent = total;
    badge.classList.toggle('hidden', total === 0);

    const list = document.getElementById('notifList');
    const items = [
      ...lowStock.map(p => `<li><span>Low stock: ${p.product_name}</span><span>${p.stock} left</span></li>`),
      ...pendingOrders.map(o => `<li><span>Pending order #${o.order_id}</span><span>${o.customer_name || 'N/A'}</span></li>`),
    ];
    list.innerHTML = items.join('') || '<li>Wala pang bagong notification.</li>';
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('notifBtn').addEventListener('click', () => {
  document.getElementById('notifDropdown').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.notif-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('notifDropdown').classList.add('hidden');
  }
});

// ===========================================================
// REVIEWS MANAGEMENT
// ===========================================================
async function loadReviews() {
  const tbody = document.getElementById('reviewsTableBody');
  try {
    const res = await fetch(API.PRODUCTS + '/reviews', { headers: authHeaders() });
    const reviews = await res.json();

    tbody.innerHTML = reviews.map(r => `
      <tr>
        <td>${r.product_name}</td>
        <td>${r.customer_name}</td>
        <td>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td>
        <td>${r.comment || '-'}</td>
        <td><span class="badge badge-${r.status === 'approved' ? 'active' : r.status === 'hidden' ? 'inactive' : 'pending'}">${r.status}</span></td>
        <td>
          ${r.status !== 'approved' ? `<button class="icon-btn" onclick="updateReviewStatus(${r.review_id}, 'approved')">Approve</button>` : ''}
          ${r.status !== 'hidden' ? `<button class="icon-btn" onclick="updateReviewStatus(${r.review_id}, 'hidden')">Hide</button>` : ''}
          <button class="icon-btn danger" onclick="deleteReview(${r.review_id})">Delete</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="6">Wala pang reviews.</td></tr>';
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6">Hindi ma-reach ang product-service (port 4001).</td></tr>';
  }
}

async function updateReviewStatus(reviewId, status) {
  await fetch(API.PRODUCTS + '/reviews/' + reviewId + '/status', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ status }),
  });
  loadReviews();
}

async function deleteReview(reviewId) {
  if (!confirm('Sigurado ka bang gusto mong i-delete ang review na ito?')) return;
  await fetch(API.PRODUCTS + '/reviews/' + reviewId, { method: 'DELETE', headers: authHeaders() });
  loadReviews();
}

// ===========================================================
// ADMIN MANAGEMENT
// ===========================================================
async function loadAdmins() {
  const tbody = document.getElementById('adminsTableBody');
  try {
    const res = await fetch(API.AUTH + '/admins', { headers: authHeaders() });
    const admins = await res.json();
    const currentAdmin = getCurrentAdmin();

    tbody.innerHTML = admins.map(a => `
      <tr>
        <td>${a.full_name}</td>
        <td>${a.username}</td>
        <td>${a.email || '-'}</td>
        <td>${a.role === 'super_admin' ? '<span class="badge badge-active">Super Admin</span>' : 'Staff'}</td>
        <td>${a.role === 'super_admin' ? 'Lahat' : (a.permissions || '').split(',').filter(Boolean).join(', ') || '-'}</td>
        <td>
          ${currentAdmin && currentAdmin.id === a.admin_id
            ? '<span style="color:var(--text-muted); font-size:13px;">Ikaw ito</span>'
            : `<button class="icon-btn danger" onclick="deleteAdmin(${a.admin_id})">Delete</button>`}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="6">Wala pang admins.</td></tr>';
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4">Hindi ma-reach ang auth-service (port 4000).</td></tr>';
  }
}

function getCurrentAdmin() {
  return JSON.parse(sessionStorage.getItem('fitora_admin') || 'null');
}

document.getElementById('addAdminBtn').addEventListener('click', () => {
  modalTitle.textContent = 'Add admin';

  // EDIT DITO: ito ang listahan ng mga pages na pwedeng bigyan ng access ang isang staff
  const PERMISSION_OPTIONS = [
    ['products', 'Products'], ['categories', 'Categories'], ['inventory', 'Inventory'],
    ['customers', 'Customers'], ['orders', 'Orders'], ['reports', 'Sales Reports'], ['reviews', 'Reviews'],
  ];

  modalForm.innerHTML = `
    <label>Full name</label>
    <input type="text" id="f_admin_name" required>

    <label>Username</label>
    <input type="text" id="f_admin_username" required>

    <label>Email</label>
    <input type="email" id="f_admin_email">

    <label>Password</label>
    <input type="password" id="f_admin_password" required>

    <label>Role</label>
    <select id="f_admin_role">
      <option value="staff">Staff (limitadong access)</option>
      <option value="super_admin">Super Admin (buong access)</option>
    </select>

    <div id="permissionsGroup">
      <label>Pwedeng buksan (para sa Staff lang)</label>
      ${PERMISSION_OPTIONS.map(([key, label]) => `
        <label style="display:flex; align-items:center; gap:8px; font-weight:normal; margin-top:6px;">
          <input type="checkbox" class="perm-checkbox" value="${key}"> ${label}
        </label>
      `).join('')}
    </div>

    <div class="modal-actions">
      <button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button>
      <button type="submit" class="primary-btn">Save</button>
    </div>
  `;

  // Itago ang permission checkboxes kapag Super Admin ang pinili (buo naman ang access nila)
  const roleSelect = document.getElementById('f_admin_role');
  const permGroup = document.getElementById('permissionsGroup');
  roleSelect.addEventListener('change', () => {
    permGroup.classList.toggle('hidden', roleSelect.value === 'super_admin');
  });

  modalForm.onsubmit = async (e) => {
    e.preventDefault();
    const checkedPerms = Array.from(document.querySelectorAll('.perm-checkbox:checked')).map(cb => cb.value);

    const payload = {
      full_name: document.getElementById('f_admin_name').value,
      username: document.getElementById('f_admin_username').value,
      email: document.getElementById('f_admin_email').value,
      password: document.getElementById('f_admin_password').value,
      role: roleSelect.value,
      permissions: roleSelect.value === 'staff' ? checkedPerms : [],
    };

    const res = await fetch(API.AUTH + '/admins', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'May error sa pag-add ng admin.');
      return;
    }

    closeModal();
    loadAdmins();
  };

  modalOverlay.classList.remove('hidden');
});

async function deleteAdmin(adminId) {
  if (!confirm('Sigurado ka bang gusto mong i-delete ang admin account na ito?')) return;
  const res = await fetch(API.AUTH + '/admins/' + adminId, { method: 'DELETE', headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Hindi ma-delete.');
    return;
  }
  loadAdmins();
}
