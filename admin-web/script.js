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
  AUTH: 'https://fitora-auth-backend.onrender.com/api/auth',
  PRODUCTS: 'https://fitora-product-service.onrender.com/api',
  ORDERS: 'https://fitora-order-service.onrender.com/api',
};

// EDIT DITO: Cloudinary config - para sa pag-upload ng product images
// mula sa computer (sa halip na paste-URL lang)
const CLOUDINARY_CLOUD_NAME = 'roit6yup';
const CLOUDINARY_UPLOAD_PRESET = 'IMAGES';

// The state of the My profile page. These are declared HERE, at the top, because the page can be opened
// right when the site loads (for example by refreshing while on My profile).
let allOrders = []; // the orders of the Orders page
let ordersPreset = null; // a filter chosen on the Dashboard (for example the pending orders), used when the Orders page opens
let inventoryPreset = null; // the same for the Inventory page (for example the low stock products)
let reviewPreset = null; // the same for the Reviews page (the reviews waiting for approval)
let allProductsList = [];
let productsPreset = null; // the same for the Products page ('pending' = the products waiting for the Super Admin)
let allProductsForInventory = []; // the products of the Inventory page
let allReviews = []; // the reviews of the Reviews page
const activityState = { before: null, loaded: 0 }; // the Activity page: where the next "Load more" continues
const chatState = { threads: [], activeId: null, activeUserId: null, lastKey: '', sending: false }; // the Messages page: the conversations, and the one that is open
const reportState = { preset: '7', from: '', to: '' }; // the period of the Sales Reports page
let reportRequest = 0;
let profileState = null;
let profileEditing = false; // the personal details are only shown, until the Edit button is pressed

// ---------------------------------------------------------
// Helper: kunin ang saved token, gamitin sa lahat ng
// protektadong request (products add/edit/delete, orders, etc.)
// ---------------------------------------------------------
function getToken() {
  return sessionStorage.getItem('fitora_token');
}

// ===========================================================
// POP-UP MESSAGES (Fitora look, instead of the browser's plain alert and confirm boxes)
// and the viewer for review photos and videos
// ===========================================================
(function addPopupStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .fx-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.62); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 10000; animation: fxFade 0.15s ease-out; }
    .fx-dialog { background: #fff; border-radius: 20px; width: 100%; max-width: 380px; padding: 28px 24px 22px; text-align: center; box-shadow: 0 18px 50px rgba(0,0,0,0.3); animation: fxPop 0.2s ease-out; }
    .fx-ring { width: 84px; height: 84px; border-radius: 50%; margin: 0 auto 14px; display: flex; align-items: center; justify-content: center; }
    .fx-icon { width: 62px; height: 62px; border-radius: 50%; color: #fff; font-size: 32px; font-weight: bold; display: flex; align-items: center; justify-content: center; }
    .fx-success .fx-ring { background: #ffe8f1; } .fx-success .fx-icon { background: #fc408c; }
    .fx-error .fx-ring { background: #fdeaea; } .fx-error .fx-icon { background: #e74c3c; }
    .fx-warning .fx-ring { background: #fdf3e3; } .fx-warning .fx-icon { background: #f4a729; }
    .fx-question .fx-ring, .fx-info .fx-ring { background: #eeeeee; } .fx-question .fx-icon, .fx-info .fx-icon { background: #111; }
    .fx-dialog h3 { margin: 0; font-size: 19px; color: #111; }
    .fx-dialog p { margin: 8px 0 0; font-size: 14px; color: #666; line-height: 1.5; }
    .fx-buttons { display: flex; gap: 10px; margin-top: 22px; }
    .fx-btn { flex: 1; border: 0; border-radius: 12px; padding: 13px 10px; font-size: 15px; font-weight: 600; cursor: pointer; color: #fff; background: #fc408c; }
    .fx-btn:hover { filter: brightness(0.95); }
    .fx-btn-cancel { background: #fff; color: #555; border: 1px solid #e2e2e2; }
    .fx-btn-danger { background: #e74c3c; }
    .fx-viewer-box { position: relative; max-width: 92vw; max-height: 88vh; }
    .fx-viewer-box img, .fx-viewer-box video { max-width: 92vw; max-height: 84vh; border-radius: 12px; background: #000; display: block; }
    .fx-viewer-close { position: absolute; top: -14px; right: -14px; width: 36px; height: 36px; border-radius: 50%; border: 0; background: #fc408c; color: #fff; font-size: 16px; cursor: pointer; }
    @keyframes fxFade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fxPop { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  `;
  document.head.appendChild(style);
})();

// Shows a pop-up and gives back the value of the button that was pressed
function openPopup({ type, title, message, buttons }) {
  return new Promise((resolve) => {
    const symbols = { success: '✓', error: '!', warning: '!', question: '?', info: 'i' };
    const overlay = document.createElement('div');
    overlay.className = 'fx-overlay';
    overlay.innerHTML = `
      <div class="fx-dialog fx-${type}" role="dialog" aria-modal="true">
        <div class="fx-ring"><div class="fx-icon">${symbols[type] || 'i'}</div></div>
        <h3>${orderEsc(title)}</h3>
        <p>${orderEsc(message)}</p>
        <div class="fx-buttons">
          ${buttons.map((b, i) => `<button type="button" class="fx-btn fx-btn-${b.style || 'primary'}" data-i="${i}">${orderEsc(b.text)}</button>`).join('')}
        </div>
      </div>`;
    const choose = (value) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(value);
    };
    const cancel = buttons.find(b => b.style === 'cancel');
    const onKey = (e) => { if (e.key === 'Escape') choose(cancel ? cancel.value : buttons[0].value); };
    overlay.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => choose(buttons[Number(btn.dataset.i)].value)));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector('button:last-child').focus();
  });
}

// The old alert("...") calls now use the Fitora pop-up (the code after them keeps running, as before)
window.alert = function (message) {
  const text = String(message == null ? '' : message);
  const problem = /could not|cannot|can't|unable|failed|invalid|not allowed|please allow|went wrong|error/i.test(text);
  openPopup({ type: problem ? 'error' : 'info', title: problem ? 'Something went wrong' : 'Notice', message: text, buttons: [{ text: 'OK', value: true }] });
};

// Replaces confirm("..."): use it as   if (!(await askConfirm('...'))) return;
function askConfirm(message, confirmText) {
  const danger = /delete|remove/i.test(message);
  const label = confirmText || (danger ? (/delete/i.test(message) ? 'Delete' : 'Remove') : 'Confirm');
  return openPopup({
    type: danger ? 'warning' : 'question',
    title: 'Please confirm',
    message,
    buttons: [{ text: 'Cancel', style: 'cancel', value: false }, { text: label, style: danger ? 'danger' : 'primary', value: true }],
  });
}

// Opens a review photo (full size) or plays a review video inside the admin panel
function openMediaViewer(url, type) {
  const overlay = document.createElement('div');
  overlay.className = 'fx-overlay';
  overlay.innerHTML = `
    <div class="fx-viewer-box">
      ${type === 'video'
        ? `<video src="${orderEsc(url)}" controls autoplay playsinline></video>`
        : `<img src="${orderEsc(url.replace('/image/upload/', '/image/upload/w_1400,q_auto/'))}" alt="Review photo">`}
      <button type="button" class="fx-viewer-close" aria-label="Close">✕</button>
    </div>`;
  const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.fx-viewer-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}

// If the server says the session ended (for example the admin account was deleted or the login expired),
// the admin is told and sent back to the login page
let sessionEndedShown = false;
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  const url = typeof args[0] === 'string' ? args[0] : '';
  if (response.status === 401 && /onrender\.com/.test(url) && getToken() && !sessionEndedShown) {
    sessionEndedShown = true;
    const data = await response.clone().json().catch(() => ({}));
    openPopup({ type: 'warning', title: 'Logged out', message: data.error || 'Your session has ended, or this account is no longer available. Please log in again.', buttons: [{ text: 'OK', value: true }] })
      .then(() => { sessionStorage.clear(); location.reload(); });
  }
  return response;
};

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
      loginError.textContent = data.error || 'Unable to log in.';
      return;
    }

    sessionStorage.setItem('fitora_token', data.token);
    sessionStorage.setItem('fitora_admin', JSON.stringify(data.admin));
    showApp();
  } catch (err) {
    loginError.textContent = 'Cannot reach the server. Please check your internet connection and try again. (The server may take up to a minute to wake up.)';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  sessionEndedShown = true; // no "Logged out" message: the admin pressed the button
  try {
    await Promise.race([fetch(API.AUTH + '/admins/me/logout', { method: 'POST', headers: authHeaders() }), new Promise(resolve => setTimeout(resolve, 2500))]);
  } catch (err) { /* not important: the admin is logged out here anyway */ }
  sessionStorage.removeItem('fitora_token');
  sessionStorage.removeItem('fitora_admin');
  location.hash = '';
  location.reload();
});

function showApp() {
  loginScreen.classList.add('hidden');
  adminApp.classList.remove('hidden');
  document.body.classList.add('app-open'); // from now on the page itself does not scroll: only the content area does
  setupStickyOffsets();
  applyDashboardLinks();
  refreshMessageBadge();

  const admin = JSON.parse(sessionStorage.getItem('fitora_admin') || '{}');
  renderAdminChip();

  applyAccessControl(admin);
  navigateTo(location.hash.replace('#', '') || 'dashboard');
  loadCategories(); // kailangan agad ito para sa product form dropdown
  loadNotifications();
  refreshAdminSession(); // the photo, the role, and the access are read again from the server

  // Auto-refresh ng notifications kada 15 segundo, para hindi na kailangang
  // i-refresh ang buong page para makita ang bagong low stock/pending order
  setInterval(loadNotifications, 15000);
}

// ===========================================================
// THE ADMIN WHO IS LOGGED IN (the chip at the top right)
// ===========================================================
function saveAdminSession(partial) {
  const merged = { ...JSON.parse(sessionStorage.getItem('fitora_admin') || '{}'), ...partial };
  sessionStorage.setItem('fitora_admin', JSON.stringify(merged));
  return merged;
}

function initialsOf(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function renderAdminChip() {
  const admin = JSON.parse(sessionStorage.getItem('fitora_admin') || '{}');
  document.getElementById('adminName').textContent = admin.fullName || '';
  document.getElementById('adminRole').textContent = admin.role === 'super_admin' ? 'Super Admin' : (admin.role ? 'Staff' : '');
  const avatar = document.getElementById('adminAvatar');
  avatar.className = 'admin-avatar';
  avatar.textContent = '';
  if (admin.profilePhoto) {
    const src = admin.profilePhoto.includes('/image/upload/') ? admin.profilePhoto.replace('/image/upload/', '/image/upload/c_fill,w_96,h_96,q_auto/') : admin.profilePhoto;
    const img = document.createElement('img');
    img.alt = '';
    img.src = src;
    img.onerror = () => { avatar.textContent = initialsOf(admin.fullName); avatar.classList.add('has-initials'); };
    avatar.appendChild(img);
  } else if (admin.fullName) {
    avatar.textContent = initialsOf(admin.fullName);
    avatar.classList.add('has-initials');
  }
}

// Reads the admin's profile again from the server (photo, role, access can have changed)
async function refreshAdminSession() {
  try {
    const res = await fetch(API.AUTH + '/admins/me', { headers: authHeaders() });
    if (!res.ok) return;
    const me = await res.json();
    const admin = saveAdminSession(me);
    renderAdminChip();
    applyAccessControl(admin);
    if (!hasAccess(location.hash.replace('#', '') || 'dashboard')) navigateTo('dashboard');
  } catch (err) {
    // not important: the saved profile is used
  }
}

// ===========================================================
// FIXED TOP PARTS: the sizes that the CSS needs to keep the title and the filters of a page in place
// (--topbar-h = the top bar, --head-h = the title and filters of the open page)
// ===========================================================
function updateStickyOffsets() {
  const style = document.documentElement.style;
  const topbar = document.querySelector('.topbar');
  const head = document.querySelector('.page.active .page-head');
  if (topbar) style.setProperty('--topbar-h', Math.ceil(topbar.getBoundingClientRect().height) + 'px');
  style.setProperty('--head-h', head ? Math.ceil(head.getBoundingClientRect().height) + 'px' : '0px');
}

let stickyWatching = false;
function setupStickyOffsets() {
  updateStickyOffsets();
  if (stickyWatching) return;
  stickyWatching = true;
  window.addEventListener('resize', updateStickyOffsets);
  if (typeof ResizeObserver === 'function') {
    const watcher = new ResizeObserver(updateStickyOffsets); // the filters can wrap to a second line, or a count can appear
    const topbar = document.querySelector('.topbar');
    if (topbar) watcher.observe(topbar);
    document.querySelectorAll('.page-head').forEach(head => watcher.observe(head));
  }
}

// EDIT DITO: ito ang listahan ng mga "gated" na tabs (hindi kasama ang dashboard,
// dahil laging bukas ito sa lahat ng naka-login na admin)
const GATED_PAGES = ['products', 'categories', 'inventory', 'customers', 'orders', 'reports', 'reviews'];

// Sinasabi kung may access ang kasalukuyang admin sa isang page
// (super_admin = laging oo; staff = tinitignan sa permissions niya)
function hasAccess(page) {
  const admin = JSON.parse(sessionStorage.getItem('fitora_admin') || '{}');
  if (page === 'dashboard' || page === 'profile') return true; // everyone can open their own profile
  if (page === 'admins' || page === 'activity') return admin.role === 'super_admin';
  if (admin.role === 'super_admin') return true;
  if (page === 'messages') return (admin.permissions || []).includes('orders') || (admin.permissions || []).includes('customers'); // the messages are for the people who work with orders or customers
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
  document.querySelector('.main-content').scrollTop = 0; // every page starts at its top
  updateStickyOffsets();

  if (page === 'dashboard') loadDashboard();
  if (page === 'products') loadProducts(true);
  if (page === 'categories') loadCategories(true);
  if (page === 'inventory') loadInventory(true);
  if (page === 'customers') loadCustomers();
  if (page === 'orders') loadOrders(true);
  if (page === 'reports') loadReports();
  if (page === 'reviews') loadReviews(true);
  if (page === 'admins') loadAdmins();
  if (page === 'activity') loadActivity(true);
  if (page === 'messages') openMessagesPage();
  if (page === 'profile') loadProfile();
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
    document.getElementById('statRevenue').textContent = peso0(orderStats.totalRevenue);

    // a line of the low stock list opens the Inventory page, showing only the low stock products
    const lowStockList = document.getElementById('lowStockList');
    lowStockList.innerHTML = lowStock.length
      ? lowStock.map(p => `<li class="clickable" data-go="inventory" data-inventory="low"><span>${orderEsc(p.product_name)}</span><span>${p.stock} left</span></li>`).join('')
      : '<li>No low-stock products.</li>';

    // a line of the recent orders opens the details of that order
    const recentList = document.getElementById('recentOrdersList');
    recentList.innerHTML = orders.slice(0, 5).map(o =>
      `<li class="clickable" data-order-id="${o.order_id}"><span><b>${orderEsc(o.order_code || 'Order #' + o.order_id)}</b> · ${orderEsc(o.customer_name || 'N/A')}${o.items_summary ? `<span class="muted-small" style="display:block">${orderEsc(o.items_summary)}</span>` : ''}</span><span class="badge badge-${orderEsc(o.status)}">${orderEsc(o.status)}</span></li>`
    ).join('') || '<li>No orders yet.</li>';
    // reviews waiting for approval (only if this admin may open the Reviews page)
    let pendingReviews = 0;
    if (hasAccess('reviews')) {
      try {
        const reviewRes = await fetch(API.PRODUCTS + '/reviews', { headers: authHeaders() });
        const reviews = await reviewRes.json();
        if (reviewRes.ok && Array.isArray(reviews)) pendingReviews = reviews.filter(r => r.status === 'pending').length;
      } catch (err) { /* the box simply does not show reviews */ }
    }
    // messages of customers that nobody has read yet (only if this admin may open the Messages page)
    let unreadMessages = 0;
    if (hasAccess('messages')) {
      try {
        const messagesRes = await fetch(API.ORDERS + '/orders/messages/unread-count', { headers: authHeaders() });
        const messagesData = await messagesRes.json();
        if (messagesRes.ok) unreadMessages = Number(messagesData.unread) || 0;
      } catch (err) { /* the box simply does not show messages */ }
    }
    renderAttention(orders, lowStock, pendingReviews, products, unreadMessages);
    applyDashboardLinks();
  } catch (err) {
    console.error(err);
  }
}

// What a card or line of the Dashboard opens. A card is only pressable if this admin may open that page.
function goFromDashboard(go, card) {
  if (!hasAccess(go)) return;
  const d = (card && card.dataset) || {};
  if (go === 'orders') {
    const status = d.status || d.filter;
    ordersPreset = status || d.payment ? { status, payment: d.payment } : null;
  }
  if (go === 'inventory') inventoryPreset = d.inventory || 'low';
  if (go === 'reviews') reviewPreset = d.reviews || null;
  if (go === 'products') productsPreset = d.approval || null;
  if (go === 'reports' && d.preset) {
    const range = presetRange(d.preset);
    Object.assign(reportState, { preset: d.preset, from: range.from, to: range.to });
  }
  location.hash = '#' + go;
}

// "Needs attention": the things the shop should look at now. Only what this admin may open is shown.
function renderAttention(orders, lowStock, pendingReviews, products, unreadMessages) {
  const list = document.getElementById('attentionList');
  const count = (test) => orders.filter(test).length;
  const isSuper = (getCurrentAdmin() || {}).role === 'super_admin';
  const productCount = (state) => (products || []).filter(p => p.approval_status === state).length;
  const lines = [
    { n: isSuper ? productCount('pending') : 0, go: 'products', data: { approval: 'pending' }, one: 'product waits for your approval', many: 'products wait for your approval', tone: 'pink' },
    { n: isSuper ? 0 : productCount('rejected'), go: 'products', data: { approval: 'rejected' }, one: 'product was rejected and needs a change', many: 'products were rejected and need a change', tone: 'red' },
    { n: unreadMessages || 0, go: 'messages', data: {}, one: 'unread message from a customer', many: 'unread messages from customers', tone: 'pink' },
    { n: count(o => o.cancel_request_status === 'requested'), go: 'orders', data: { status: 'cancel_requests' }, one: 'customer asks to cancel an order', many: 'customers ask to cancel an order', tone: 'red' },
    { n: count(o => o.payment_status === 'refund_pending'), go: 'orders', data: { payment: 'refund_pending' }, one: 'refund to give back to a customer', many: 'refunds to give back to customers', tone: 'red' },
    { n: count(o => o.status === 'pending' && !(o.payment_method === 'gcash' && o.payment_status === 'awaiting_payment')), go: 'orders', data: { status: 'pending', payment: 'ready' }, one: 'new order to process', many: 'new orders to process', tone: 'pink' },
    { n: count(o => o.status === 'processing'), go: 'orders', data: { status: 'processing' }, one: 'order to ship', many: 'orders to ship', tone: 'pink' },
    { n: count(o => o.payment_method === 'gcash' && o.payment_status === 'awaiting_payment'), go: 'orders', data: { payment: 'awaiting' }, one: 'GCash order waiting for payment', many: 'GCash orders waiting for payment', tone: 'amber' },
    { n: lowStock.filter(p => Number(p.stock) <= 0).length, go: 'inventory', data: { inventory: 'out' }, one: 'product is out of stock', many: 'products are out of stock', tone: 'red' },
    { n: lowStock.filter(p => Number(p.stock) > 0).length, go: 'inventory', data: { inventory: 'low' }, one: 'product is running low', many: 'products are running low', tone: 'amber' },
    { n: pendingReviews, go: 'reviews', data: { reviews: 'pending' }, one: 'review waits for approval', many: 'reviews wait for approval', tone: 'amber' },
  ].filter(line => line.n > 0 && hasAccess(line.go));
  list.innerHTML = lines.length
    ? lines.map(line => `<li class="clickable attention-${line.tone}" data-go="${line.go}" ${Object.entries(line.data).map(([k, v]) => `data-${k}="${v}"`).join(' ')}><span><b>${line.n}</b> ${line.n === 1 ? line.one : line.many}</span><span class="attention-view">View &rarr;</span></li>`).join('')
    : '<li class="attention-clear">All clear. Nothing needs your attention right now.</li>';
}

function applyDashboardLinks() {
  document.querySelectorAll('#page-dashboard .stat-card[data-go]').forEach(card => {
    const allowed = hasAccess(card.dataset.go);
    card.classList.toggle('clickable', allowed);
    if (allowed) { card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0'); }
    else { card.removeAttribute('role'); card.removeAttribute('tabindex'); }
  });
}

document.querySelectorAll('#page-dashboard .stat-card[data-go]').forEach(card => {
  card.addEventListener('click', () => goFromDashboard(card.dataset.go, card));
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goFromDashboard(card.dataset.go, card); } });
});
document.getElementById('recentOrdersList').addEventListener('click', (e) => {
  const line = e.target.closest('[data-order-id]');
  if (line) openOrderDetails(Number(line.dataset.orderId));
});
document.getElementById('lowStockList').addEventListener('click', (e) => {
  if (e.target.closest('[data-go]')) goFromDashboard('inventory');
});
document.getElementById('attentionList').addEventListener('click', (e) => {
  const line = e.target.closest('[data-go]');
  if (line) goFromDashboard(line.dataset.go, line);
});

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
          <td><b>${orderEsc(c.category_name)}</b></td>
          <td>${orderEsc(c.description || '')}</td>
          <td><span class="count-pill">${c.product_count || 0}</span></td>
          <td><span class="count-pill count-men">${c.men_count || 0}</span></td>
          <td><span class="count-pill count-women">${c.women_count || 0}</span></td>
          <td><span class="count-pill">${c.unisex_count || 0}</span></td>
          <td>
            <button class="icon-btn" onclick="openCategoryModal(${c.category_id})">Edit</button>
            <button class="icon-btn danger" onclick="deleteCategory(${c.category_id})">Delete</button>
          </td>
        </tr>
      `).join('') || '<tr><td colspan="7">No categories yet.</td></tr>';
    }
  } catch (err) {
    console.error(err);
  }
}


async function loadProducts(resetFilters) {
  const tbody = document.getElementById('productsTableBody');
  if (resetFilters) {
    // when the page is opened: empty filters (or what the Dashboard / the bell chose), set at once
    document.getElementById('productSearch').value = '';
    document.getElementById('productCategoryFilter').value = 'all';
    document.getElementById('productAudienceFilter').value = 'all';
    document.getElementById('productApprovalFilter').value = productsPreset || 'all';
    document.getElementById('productSort').value = 'default';
    productsPreset = null;
    if (allProductsList.length) renderProductsTable();
  }
  try {
    const res = await fetch(API.PRODUCTS + '/products');
    allProductsList = await res.json();
    populateProductCategoryFilter();
    renderProductsTable();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6">Cannot reach the product service. Please try again.</td></tr>';
  }
}

function populateProductCategoryFilter() {
  const select = document.getElementById('productCategoryFilter');
  const current = select.value;
  select.innerHTML = '<option value="all">All categories</option>' +
    allCategories.map(c => `<option value="${c.category_id}">${c.category_name}</option>`).join('');
  select.value = current || 'all';
}

// A small message at the bottom of the screen ("Saved"), used for quick changes
function showToast(message, isError) {
  const toast = document.createElement('div');
  toast.className = 'toast' + (isError ? ' toast-error' : '');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('toast-out'), 1800);
  setTimeout(() => toast.remove(), 2300);
}

const AUDIENCE_LABELS = { men: 'Men', women: 'Women', unisex: 'Unisex' };

// the stock in a colored pill: green is fine, yellow is low (fewer than 10), red is out of stock
function stockPill(value) {
  const n = Number(value) || 0;
  const tone = n <= 0 ? 'stock-out' : n < 10 ? 'stock-low' : 'stock-ok';
  const note = n <= 0 ? 'Out of stock' : n < 10 ? 'Low stock' : '';
  return `<span class="stock-pill ${tone}">${n}</span>${note ? `<div class="muted-small">${note}</div>` : ''}`;
}

function renderProductsTable() {
  const tbody = document.getElementById('productsTableBody');
  const search = document.getElementById('productSearch').value.toLowerCase().trim();
  const categoryFilter = document.getElementById('productCategoryFilter').value;
  const audienceFilter = document.getElementById('productAudienceFilter').value;
  const approvalFilter = document.getElementById('productApprovalFilter').value;
  const isSuper = (getCurrentAdmin() || {}).role === 'super_admin';
  const sort = document.getElementById('productSort').value;

  let list = allProductsList.filter(p => {
    const matchesSearch = !search || p.product_name.toLowerCase().includes(search);
    const matchesCategory = categoryFilter === 'all' || String(p.category_id) === categoryFilter;
    const matchesAudience = audienceFilter === 'all' || (p.audience || 'unisex') === audienceFilter;
    const matchesApproval = approvalFilter === 'all' || (p.approval_status || 'approved') === approvalFilter;
    return matchesSearch && matchesCategory && matchesAudience && matchesApproval;
  });

  if (sort === 'price_asc') list = [...list].sort((a, b) => a.price - b.price);
  if (sort === 'price_desc') list = [...list].sort((a, b) => b.price - a.price);
  if (sort === 'stock_asc') list = [...list].sort((a, b) => a.stock - b.stock);
  if (sort === 'stock_desc') list = [...list].sort((a, b) => b.stock - a.stock);

  tbody.innerHTML = list.map(p => {
    const audience = p.audience || 'unisex';
    const approval = p.approval_status || 'approved';
    return `
    <tr data-product-id="${p.product_id}">
      <td>${p.image
        ? `<img src="${orderEsc(p.image)}" class="thumb" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'), {className:'thumb-placeholder', textContent:'📦'}))">`
        : `<div class="thumb-placeholder">📦</div>`}</td>
      <td>${orderEsc(p.product_name)}</td>
      <td>${orderEsc(p.category_name || '-')}</td>
      <td><span class="badge badge-${audience}">${AUDIENCE_LABELS[audience]}</span></td>
      <td>₱${Number(p.price).toLocaleString()}</td>
      <td>${stockPill(p.stock)}</td>
      <td>${approval === 'pending'
        ? '<span class="badge badge-plain badge-pending">Waiting for approval</span><div class="muted-small">Not for sale yet</div>'
        : approval === 'rejected'
          ? `<span class="badge badge-plain badge-cancelled">Rejected</span><div class="muted-small">${orderEsc(p.approval_note || '')}</div>`
          : `<select class="status-select tone-${orderEsc(p.status)}" aria-label="Status" onchange="quickUpdateProduct(${p.product_id}, { status: this.value })">
          <option value="active" ${p.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="inactive" ${p.status === 'inactive' ? 'selected' : ''}>Inactive</option>
        </select>`}</td>
      <td>
        ${approval === 'pending' && isSuper ? `<button class="icon-btn" onclick="approveProduct(${p.product_id})">Approve</button><button class="icon-btn danger" onclick="rejectProduct(${p.product_id})">Reject</button>` : ''}
        <button class="icon-btn" onclick="openImagesModal(${p.product_id})">Photos</button>
        <button class="icon-btn" onclick="openProductModal(${p.product_id})">Edit</button>
        <button class="icon-btn danger" onclick="deleteProduct(${p.product_id})">Delete</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="8">No matching products.</td></tr>';
}

// Changes the status (active / inactive) right from the table. Who the product is for is set in the Edit / Add form only.
async function quickUpdateProduct(productId, changes) {
  try {
    const res = await fetch(API.PRODUCTS + '/products/' + productId + '/quick', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(changes) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save the change.');
    const product = allProductsList.find(p => p.product_id === productId);
    if (product) Object.assign(product, changes);
    renderProductsTable();
    showToast(changes.status ? (changes.status === 'active' ? 'Product is now active and visible in the app.' : 'Product is now inactive and hidden from the app.') : 'Saved.');
  } catch (err) {
    showToast(err.message, true);
    renderProductsTable(); // put the dropdown back to what is saved
  }
}

document.getElementById('productSearch').addEventListener('input', renderProductsTable);
document.getElementById('productCategoryFilter').addEventListener('change', renderProductsTable);
document.getElementById('inventorySearch').addEventListener('input', renderInventoryTable);
document.getElementById('inventoryFilter').addEventListener('change', renderInventoryTable);
document.getElementById('reviewStatusFilter').addEventListener('change', renderReviews);
document.getElementById('productAudienceFilter').addEventListener('change', renderProductsTable);
document.getElementById('productApprovalFilter').addEventListener('change', renderProductsTable);

// the Orders page
['orderSearch'].forEach(id => document.getElementById(id).addEventListener('input', () => renderOrders()));
['orderStatusFilter', 'orderPaymentFilter', 'orderFrom', 'orderTo'].forEach(id => document.getElementById(id).addEventListener('change', () => renderOrders()));
document.getElementById('orderClear').addEventListener('click', () => { resetOrderFilterInputs(); renderOrders(); });
document.getElementById('orderExport').addEventListener('click', exportOrdersCsv);

// the Activity page
['activityAdmin', 'activityType', 'activityFrom', 'activityTo'].forEach(id => document.getElementById(id).addEventListener('change', () => loadActivity(true)));
document.getElementById('activityRefresh').addEventListener('click', () => loadActivity(true));
document.getElementById('activityMore').addEventListener('click', () => loadActivity(false));
document.getElementById('activityClear').addEventListener('click', () => {
  ['activityAdmin', 'activityType', 'activityFrom', 'activityTo'].forEach(id => { document.getElementById(id).value = ''; });
  loadActivity(true);
});

// the Reports page
document.querySelectorAll('#reportRanges .chip').forEach(chip => chip.addEventListener('click', () => choosePreset(chip.dataset.range)));
document.getElementById('reportApply').addEventListener('click', applyCustomRange);
document.getElementById('reportExport').addEventListener('click', exportReportCsv);
document.getElementById('productSort').addEventListener('change', renderProductsTable);

// ----- the Super Admin decides about the products that staff added -----
const PRODUCT_REJECT_REASONS = ['Wrong price', 'Wrong or missing photo', 'Wrong name or description', 'Not allowed to sell', 'Other'];

async function sendProductApproval(productId, body) {
  try {
    const res = await fetch(API.PRODUCTS + '/products/' + productId + '/approval', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save the decision.');
    await loadProducts();
    showToast(data.message);
    return true;
  } catch (err) {
    showApiError(err.message);
    return false;
  }
}

async function approveProduct(productId) {
  const p = allProductsList.find(x => x.product_id === productId);
  const name = p ? p.product_name : 'this product';
  if (!(await askConfirm(`Approve "${name}"? It becomes active, and customers can see and buy it.`, 'Approve'))) return;
  await sendProductApproval(productId, { decision: 'approve' });
}

function rejectProduct(productId) {
  const p = allProductsList.find(x => x.product_id === productId);
  const name = p ? p.product_name : 'this product';
  openReasonModal(`Reject "${name}"`, 'The product stays hidden from customers. The staff member can change it and send it again.', PRODUCT_REJECT_REASONS, 'Reject', async (reason) => {
    if (await sendProductApproval(productId, { decision: 'reject', reason })) closeModal();
  });
}

async function deleteProduct(id) {
  if (!(await askConfirm('Are you sure you want to delete this product?'))) return;
  await fetch(API.PRODUCTS + '/products/' + id, { method: 'DELETE', headers: authHeaders() });
  loadProducts();
}

async function deleteCategory(id) {
  if (!(await askConfirm('Are you sure you want to delete this category?'))) return;
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
  document.querySelector('#modalOverlay .modal').classList.remove('modal-wide');
}

async function openProductModal(productId) {
  const isSuper = (getCurrentAdmin() || {}).role === 'super_admin';
  let product = { product_name: '', category_id: '', audience: 'unisex', price: '', stock: 0, weight_grams: 300, status: 'active', description: '', image: '' };

  if (productId) {
    const res = await fetch(API.PRODUCTS + '/products/' + productId);
    product = await res.json();
    modalTitle.textContent = 'Edit product';
  } else {
    modalTitle.textContent = 'Add product';
  }

  // What the product is waiting for. A NEW product of a staff member waits for the Super Admin; a product that is waiting or rejected stays inactive.
  const approval = productId ? (product.approval_status || 'approved') : (isSuper ? 'approved' : 'pending');
  const approvalNotice = approval === 'pending'
    ? `<div class="detail-note">${productId ? 'This product is waiting for a Super Admin to approve it. Customers cannot see it yet.' : 'A Super Admin has to approve this product before customers can see it.'}</div>`
    : approval === 'rejected'
      ? `<div class="detail-note detail-note-danger">This product was rejected${product.approval_note ? ': ' + orderEsc(product.approval_note) : ''}. ${isSuper ? 'The staff member can change it and send it again.' : 'Change it and press Save to send it for approval again.'}</div>`
      : '';

  const categoryOptions = allCategories.map(c =>
    `<option value="${c.category_id}" ${c.category_id === product.category_id ? 'selected' : ''}>${orderEsc(c.category_name)}</option>`
  ).join('');

  modalForm.innerHTML = `
    ${approvalNotice}
    <label>Product name</label>
    <input type="text" id="f_name" value="${orderEsc(product.product_name || '')}" required>

    <label>Category</label>
    <select id="f_category">
      <option value="">-- No category --</option>
      ${categoryOptions}
    </select>

    <label>For</label>
    <select id="f_audience">
      <option value="unisex" ${(product.audience || 'unisex') === 'unisex' ? 'selected' : ''}>Everyone (unisex)</option>
      <option value="men" ${product.audience === 'men' ? 'selected' : ''}>Men</option>
      <option value="women" ${product.audience === 'women' ? 'selected' : ''}>Women</option>
    </select>

    <label>Description</label>
    <textarea id="f_description" rows="2">${orderEsc(product.description || '')}</textarea>

    <label>Image URL</label>
    <input type="text" id="f_image" placeholder="https://..." value="${orderEsc(product.image || '')}">

    <label>Or upload from your computer</label>
    <input type="file" id="f_image_file" accept="image/*">
    <p id="uploadStatus" style="font-size:12px; color:#888; margin-top:4px;"></p>

    ${productId ? `
    <label>Gallery (extra photos: front, back, side, etc.)</label>
    <div id="galleryThumbs" class="gallery-thumbs"><p style="font-size:12px;color:#888;">Loading...</p></div>
    <input type="file" id="f_gallery_file" accept="image/*" multiple>
    <p id="galleryUploadStatus" style="font-size:12px; color:#888; margin-top:4px;"></p>
    ` : ''}

    <label>Price (₱)</label>
    <input type="number" id="f_price" step="0.01" value="${product.price || ''}" required>

    <label>Stock</label>
    <input type="number" id="f_stock" value="${product.stock || 0}" required>

    <label>Weight (grams, used for the shipping fee)</label>
    <input type="number" id="f_weight" min="1" max="50000" step="1" value="${product.weight_grams || 300}" required>

    ${approval === 'approved' ? `<label>Status</label>
    <select id="f_status">
      <option value="active" ${product.status === 'active' ? 'selected' : ''}>Active</option>
      <option value="inactive" ${product.status === 'inactive' ? 'selected' : ''}>Inactive</option>
    </select>` : ''}

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
      audience: document.getElementById('f_audience').value,
      description: document.getElementById('f_description').value,
      image: document.getElementById('f_image').value.trim(),
      price: parseFloat(document.getElementById('f_price').value),
      stock: parseInt(document.getElementById('f_stock').value),
      weight_grams: parseInt(document.getElementById('f_weight').value),
      status: approval === 'approved' ? document.getElementById('f_status').value : 'inactive', // a product that is not approved is never active
    };

    const url = productId ? API.PRODUCTS + '/products/' + productId : API.PRODUCTS + '/products';
    const method = productId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the product.');
      closeModal();
      await loadProducts();
      showToast(data.approval_status === 'pending' && data.message ? data.message : (productId ? 'Product saved.' : 'Product added.'));
    } catch (err) {
      showApiError(err.message); // the form stays open, so nothing typed is lost
    }
  };

  // BAGO: pag-upload ng larawan mula sa computer papunta sa Cloudinary
  const imageFileInput = document.getElementById('f_image_file');
  const imageUrlInput = document.getElementById('f_image');
  const uploadStatus = document.getElementById('uploadStatus');

  imageFileInput.addEventListener('change', async () => {
    const file = imageFileInput.files[0];
    if (!file) return;

    uploadStatus.textContent = 'Uploading...';

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    try {
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.secure_url) {
        imageUrlInput.value = data.secure_url;
        uploadStatus.textContent = '✓ Upload successful!';
      } else {
        uploadStatus.textContent = 'Upload failed. Please try again.';
      }
    } catch (err) {
      uploadStatus.textContent = 'Could not upload. Please check your internet connection.';
    }
  });

  // BAGO: gallery ng dagdag na larawan (harap, likod, gilid, atbp.)
  // Makikita lang ito kapag nag-e-edit ng EXISTING product (kailangan ng
  // productId bago tayo makapag-attach ng dagdag na larawan dito)
  const galleryFileInput = document.getElementById('f_gallery_file');
  if (galleryFileInput) {
    loadProductGallery(productId);

    galleryFileInput.addEventListener('change', async () => {
      const files = Array.from(galleryFileInput.files);
      if (files.length === 0) return;

      const galleryUploadStatus = document.getElementById('galleryUploadStatus');

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        galleryUploadStatus.textContent = `Uploading ${i + 1} of ${files.length}...`;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

        try {
          const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
            method: 'POST',
            body: formData,
          });
          const uploadData = await uploadRes.json();

          if (uploadData.secure_url) {
            await fetch(API.PRODUCTS + '/products/' + productId + '/images', {
              method: 'POST',
              headers: authHeaders(),
              body: JSON.stringify({ image_url: uploadData.secure_url }),
            });
          }
        } catch (err) {
          console.error(err);
        }
      }

      galleryUploadStatus.textContent = `✓ ${files.length} photo(s) added to the gallery!`;
      galleryFileInput.value = '';
      loadProductGallery(productId);
    });
  }

  modalOverlay.classList.remove('hidden');
}

// Kunin at ipakita ang lahat ng larawan sa gallery ng isang product
async function loadProductGallery(productId) {
  const container = document.getElementById('galleryThumbs');
  if (!container) return;

  try {
    const res = await fetch(API.PRODUCTS + '/products/' + productId + '/images');
    const images = await res.json();

    container.innerHTML = images.map(img => `
      <div class="gallery-thumb-wrap">
        <img src="${img.image_url}" class="gallery-thumb">
        <button type="button" class="gallery-remove-btn" onclick="deleteGalleryImage(${img.image_id}, ${productId})">×</button>
      </div>
    `).join('') || '<p style="font-size:12px;color:#888;">No extra photos yet.</p>';
  } catch (err) {
    container.innerHTML = '<p style="font-size:12px;color:#e74c3c;">Could not load the gallery.</p>';
  }
}

// Tanggalin ang isang larawan mula sa gallery
async function deleteGalleryImage(imageId, productId) {
  await fetch(API.PRODUCTS + '/products/images/' + imageId, { method: 'DELETE', headers: authHeaders() });
  loadProductGallery(productId);
}

// ---------------- MODAL: PRODUCT PHOTOS ----------------
// Shows ALL photos of one product. The admin can add many photos at once,
// delete a specific photo, and choose which photo is the Main one.
function imgEsc(text) {
  return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function openImagesModal(productId) {
  const product = allProductsList.find(p => p.product_id === productId);
  modalTitle.textContent = 'Photos - ' + (product ? product.product_name : 'Product');
  modalForm.onsubmit = (e) => { e.preventDefault(); };
  modalForm.innerHTML = `
    <p style="font-size:13px; color:#666; margin-bottom:6px;">
      The photo marked <b>Main</b> is the one shown in the shop list. Add as many extra photos as you like (front, back, side...).
    </p>
    <div id="imagesGrid" class="images-grid"><p style="font-size:12px; color:#888;">Loading...</p></div>

    <label>Add photos (you can select many at once)</label>
    <input type="file" id="img_add_files" accept="image/*" multiple>
    <p id="imgAddStatus" style="font-size:12px; color:#888; margin-top:4px;"></p>

    <div class="modal-actions">
      <button type="button" class="secondary-btn" onclick="closeModal()">Close</button>
    </div>
  `;

  document.getElementById('img_add_files').addEventListener('change', (e) => addProductImages(productId, e.target));

  modalOverlay.classList.remove('hidden');
  renderImagesGrid(productId);
}

async function renderImagesGrid(productId) {
  const grid = document.getElementById('imagesGrid');
  if (!grid) return;
  const product = allProductsList.find(p => p.product_id === productId);

  try {
    const res = await fetch(API.PRODUCTS + '/products/' + productId + '/images');
    if (!res.ok) throw new Error('Could not load photos');
    const gallery = await res.json();
    const mainUrl = product && product.image ? product.image : null;
    const galleryUrls = gallery.map(g => g.image_url);

    let tiles = '';
    // The main photo may have been pasted as a link and not be in the gallery list
    if (mainUrl && !galleryUrls.includes(mainUrl)) {
      tiles += `
        <div class="image-tile">
          <img src="${imgEsc(mainUrl)}" alt="Main photo">
          <span class="image-tag">Main</span>
          <div class="tile-actions">
            <button type="button" class="icon-btn danger" onclick="removeMainImage(${productId})">Remove</button>
          </div>
        </div>`;
    }
    gallery.forEach(img => {
      const isMain = img.image_url === mainUrl;
      tiles += `
        <div class="image-tile">
          <img src="${imgEsc(img.image_url)}" alt="Product photo">
          ${isMain ? '<span class="image-tag">Main</span>' : ''}
          <div class="tile-actions">
            ${isMain ? '' : `<button type="button" class="icon-btn" onclick="setMainImage(${productId}, ${img.image_id})">Make main</button>`}
            <button type="button" class="icon-btn danger" onclick="deleteProductImage(${img.image_id}, ${productId})">Delete</button>
          </div>
        </div>`;
    });

    grid.innerHTML = tiles || '<p style="font-size:12px; color:#888;">No photos yet. Add some below.</p>';
  } catch (err) {
    grid.innerHTML = '<p style="font-size:12px; color:#e74c3c;">Could not load the photos. Make sure the latest product service is deployed and the product_images table exists in the database.</p>';
  }
}

// Saves (or clears) the main photo of a product. Uses the freshest product data so stock is never overwritten with an old number.
async function saveMainImage(productId, url) {
  const freshRes = await fetch(API.PRODUCTS + '/products/' + productId);
  const p = await freshRes.json();
  const body = {
    product_name: p.product_name,
    category_id: p.category_id,
    description: p.description || '',
    price: parseFloat(p.price),
    stock: parseInt(p.stock),
    status: p.status,
    image: url || '',
  };
  const res = await fetch(API.PRODUCTS + '/products/' + productId, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not update the main photo.');
  }
  await loadProducts(); // refresh the table and the product list
}

async function addProductImages(productId, input) {
  const files = Array.from(input.files);
  const status = document.getElementById('imgAddStatus');
  if (files.length === 0) return;

  let added = 0;
  let firstUrl = null;
  for (let i = 0; i < files.length; i++) {
    status.textContent = `Uploading ${i + 1} of ${files.length}...`;
    try {
      const formData = new FormData();
      formData.append('file', files[i]);
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      const upload = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: 'POST',
        body: formData,
      });
      const uploaded = await upload.json();
      if (!uploaded.secure_url) continue;

      const saved = await fetch(API.PRODUCTS + '/products/' + productId + '/images', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ image_url: uploaded.secure_url }),
      });
      if (saved.ok) {
        added++;
        if (!firstUrl) firstUrl = uploaded.secure_url;
      }
    } catch (err) {
      console.error(err);
    }
  }
  input.value = '';

  // If the product has no main photo yet, the first new photo becomes the main one
  const product = allProductsList.find(p => p.product_id === productId);
  if (firstUrl && product && !product.image) {
    try { await saveMainImage(productId, firstUrl); } catch (err) { console.error(err); }
  }

  status.textContent = added === files.length
    ? `✓ ${added} photo(s) added!`
    : `${added} of ${files.length} photo(s) added. Some uploads failed, please try again.`;
  renderImagesGrid(productId);
}

async function setMainImage(productId, imageId) {
  try {
    const res = await fetch(API.PRODUCTS + '/products/' + productId + '/images');
    const gallery = await res.json();
    const img = gallery.find(g => g.image_id === imageId);
    if (img) await saveMainImage(productId, img.image_url);
  } catch (err) {
    alert(err.message);
  }
  renderImagesGrid(productId);
}

async function removeMainImage(productId) {
  if (!(await askConfirm('Remove the main photo? The product will show a placeholder until you choose another one.'))) return;
  try {
    await saveMainImage(productId, '');
  } catch (err) {
    alert(err.message);
  }
  renderImagesGrid(productId);
}

async function deleteProductImage(imageId, productId) {
  if (!(await askConfirm('Delete this photo?'))) return;
  try {
    const galleryRes = await fetch(API.PRODUCTS + '/products/' + productId + '/images');
    const gallery = await galleryRes.json();
    const img = gallery.find(g => g.image_id === imageId);
    const product = allProductsList.find(p => p.product_id === productId);

    const res = await fetch(API.PRODUCTS + '/products/images/' + imageId, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Could not delete the photo.');
    }
    // If the deleted photo was the main one, clear the main photo too
    if (img && product && product.image === img.image_url) await saveMainImage(productId, '');
  } catch (err) {
    alert(err.message);
  }
  renderImagesGrid(productId);
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

async function loadInventory(resetFilters) {
  const tbody = document.getElementById('inventoryTableBody');
  if (resetFilters) {
    // the filter is set at once (what the Dashboard chose, or empty)
    document.getElementById('inventorySearch').value = '';
    document.getElementById('inventoryFilter').value = inventoryPreset || 'all';
    inventoryPreset = null;
    if (allProductsForInventory.length) renderInventoryTable();
  }
  try {
    const res = await fetch(API.PRODUCTS + '/products');
    allProductsForInventory = await res.json();
    renderInventoryTable();
    loadStockLogs();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5">Cannot reach the product service. Please try again.</td></tr>';
  }
}

const LOW_STOCK_LIMIT = 10; // EDIT DITO: fewer than this = "low stock" (the same rule as the notifications)

function stockState(stock) {
  if (stock <= 0) return 'out';
  return stock < LOW_STOCK_LIMIT ? 'low' : 'ok';
}
const STOCK_STATE_LABELS = { out: 'Out of stock', low: 'Low stock', ok: 'In stock' };
const STOCK_STATE_BADGES = { out: 'badge-cancelled', low: 'badge-pending', ok: 'badge-active' };

function renderInventoryTable() {
  const tbody = document.getElementById('inventoryTableBody');
  const filter = document.getElementById('inventoryFilter').value;
  const search = document.getElementById('inventorySearch').value.toLowerCase().trim();

  // the numbers on top
  const counts = { ok: 0, low: 0, out: 0 };
  let units = 0;
  allProductsForInventory.forEach(p => { counts[stockState(p.stock)]++; units += Number(p.stock) || 0; });
  document.getElementById('inventoryStats').innerHTML = `
    <div class="stat-card"><h3>In stock</h3><div class="value">${counts.ok}</div></div>
    <div class="stat-card"><h3>Low stock</h3><div class="value">${counts.low}</div></div>
    <div class="stat-card"><h3>Out of stock</h3><div class="value">${counts.out}</div></div>
    <div class="stat-card"><h3>Total units</h3><div class="value">${units.toLocaleString()}</div></div>`;

  const list = allProductsForInventory.filter(p => {
    const matchesSearch = !search || p.product_name.toLowerCase().includes(search);
    const matchesFilter = filter === 'all' || stockState(p.stock) === filter;
    return matchesSearch && matchesFilter;
  });

  tbody.innerHTML = list.map(p => {
    const state = stockState(p.stock);
    return `
    <tr data-product-id="${p.product_id}">
      <td><div class="inv-product">${productPicture(p.image)}<b>${orderEsc(p.product_name)}</b></div></td>
      <td>${orderEsc(p.category_name || '-')}</td>
      <td><span class="inv-count">${p.stock}</span></td>
      <td><span class="badge badge-plain ${STOCK_STATE_BADGES[state]}">${STOCK_STATE_LABELS[state]}</span></td>
      <td>
        <button class="icon-btn" onclick="openStockModal(${p.product_id}, 'add')">Restock</button>
        <button class="icon-btn" onclick="openStockModal(${p.product_id}, 'set')">Correct</button>
        <button class="icon-btn" onclick="openStockHistory(${p.product_id})">History</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="5">No matching products.</td></tr>';
}

// One line of the stock history: what happened and how the stock moved
function stockMove(log) {
  const sign = log.change_amount > 0 ? '+' : '';
  return `<span class="${log.change_amount > 0 ? 'text-success' : 'text-danger'}">${sign}${log.change_amount}</span>`;
}

async function loadStockLogs() {
  const list = document.getElementById('stockLogsList');
  try {
    const res = await fetch(API.PRODUCTS + '/products/stock-logs/recent', { headers: authHeaders() });
    const logs = await res.json();
    if (!res.ok) throw new Error(logs.error || 'Could not load the stock history.');

    list.innerHTML = logs.map(l => `
      <li>
        <span><b>${orderEsc(l.product_name || 'Removed product')}</b> · ${orderEsc(l.reason || '')}${l.stock_before != null ? ` <span class="muted-small">(${l.stock_before} → ${l.stock_after})</span>` : ''}
          <span class="muted-small" style="display:block">${orderEsc(l.admin_name || 'Customer order or system')} · ${orderEsc(timeAgo(l.created_at))}${l.note ? ' · ' + orderEsc(l.note) : ''}</span></span>
        ${stockMove(l)}
      </li>`).join('') || '<li>No stock changes yet.</li>';
  } catch (err) {
    list.innerHTML = '<li>Could not load the stock history.</li>';
  }
}

// The whole history of ONE product
async function openStockHistory(productId) {
  const product = allProductsForInventory.find(p => p.product_id === productId);
  showDetails('Stock history', '<p class="detail-loading">Loading...</p>');
  try {
    const res = await fetch(API.PRODUCTS + '/products/stock-logs/recent?product_id=' + productId + '&limit=50', { headers: authHeaders() });
    const logs = await res.json();
    if (!res.ok) throw new Error(logs.error || 'Could not load the stock history.');
    const rows = logs.map(l => `
      <tr>
        <td>${orderEsc(new Date(l.created_at).toLocaleString())}</td>
        <td><b>${orderEsc(l.reason || '-')}</b>${l.note ? `<div class="muted-small">${orderEsc(l.note)}</div>` : ''}</td>
        <td>${stockMove(l)}</td>
        <td>${l.stock_before != null ? `${l.stock_before} → <b>${l.stock_after}</b>` : '-'}</td>
        <td>${orderEsc(l.admin_name || 'Customer order or system')}</td>
      </tr>`).join('') || '<tr><td colspan="5">No stock changes for this product yet.</td></tr>';
    showDetails('Stock history', `
      <div class="detail-top">
        <div class="inv-product">${productPicture(product && product.image)}<div><div class="detail-code" style="font-size:18px">${orderEsc(product ? product.product_name : 'Product')}</div><div class="muted-small">Now in stock: <b>${product ? product.stock : '-'}</b></div></div></div>
      </div>
      <div class="table-wrap" style="max-height:52vh">
        <table><thead><tr><th>When</th><th>What happened</th><th>Change</th><th>Stock</th><th>By</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
      <div class="modal-actions"><button type="button" class="primary-btn" onclick="closeModal()">Close</button></div>`);
  } catch (err) {
    detailsError('Stock history', err.message);
  }
}

// The window to change the stock. Three ways:
//   Restock    = add to the stock            (10 + 5 = 15)
//   Remove     = take away (damaged / lost)  (10 - 3 = 7)
//   Correction = set the exact stock         (the stock BECOMES the number you type)
function openStockModal(productId, startMode) {
  const product = allProductsForInventory.find(p => p.product_id === productId);
  const current = Number(product.stock);
  let mode = startMode || 'add';
  document.querySelector('#modalOverlay .modal').classList.remove('modal-wide');
  modalTitle.textContent = 'Stock - ' + product.product_name;

  const MODES = {
    add: { label: 'How many are you adding?', help: 'Restock: the number you type is ADDED to the current stock.', min: 1, start: 1 },
    remove: { label: 'How many are you removing?', help: 'Remove: the number you type is TAKEN AWAY from the current stock (damaged or lost items).', min: 1, start: 1 },
    set: { label: 'What is the correct stock now?', help: 'Correction: the stock BECOMES the number you type. It is not added or subtracted. Use it after counting the shelf.', min: 0, start: current },
  };

  modalForm.innerHTML = `
    <div class="stock-now"><span>Current stock</span><b>${current}</b></div>
    <div class="mode-tabs">
      <button type="button" class="mode-tab" data-mode="add">Restock<small>add more</small></button>
      <button type="button" class="mode-tab" data-mode="remove">Remove<small>damaged / lost</small></button>
      <button type="button" class="mode-tab" data-mode="set">Correction<small>set exact stock</small></button>
    </div>
    <p id="stockHelp" class="muted-small"></p>
    <label id="stockQtyLabel"></label>
    <input type="number" id="f_quantity" step="1" required>
    <div id="stockReasonBox" class="hidden">
      <label>Reason</label>
      <select id="f_stock_reason"><option>Damaged</option><option>Lost</option><option>Other</option></select>
    </div>
    <label>Note (optional)</label>
    <input type="text" id="f_note" maxlength="200" placeholder="For example: new delivery from the supplier">
    <div id="stockPreview" class="stock-preview"></div>
    <div class="modal-actions">
      <button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button>
      <button type="submit" id="stockSave" class="primary-btn">Save</button>
    </div>`;

  const input = document.getElementById('f_quantity');
  const preview = document.getElementById('stockPreview');
  const save = document.getElementById('stockSave');

  function update() {
    const q = Number(input.value);
    const valid = input.value !== '' && Number.isInteger(q) && q >= MODES[mode].min;
    let after = NaN;
    if (valid) after = mode === 'add' ? current + q : mode === 'remove' ? current - q : q;
    let message = '';
    let ok = valid;
    if (!valid) message = 'Please enter a whole number.';
    else if (after < 0) { ok = false; message = `There are only ${current} in stock, so you cannot remove ${q}.`; }
    else if (after === current) { ok = false; message = `The stock is already ${current}. Nothing to change.`; }
    else message = `The stock will change from <b>${current}</b> to <b>${after}</b> (${after > current ? '+' : ''}${after - current}).`;
    preview.innerHTML = message;
    preview.className = 'stock-preview ' + (ok ? 'stock-preview-ok' : 'stock-preview-bad');
    save.disabled = !ok;
  }

  function choose(newMode) {
    mode = newMode;
    modalForm.querySelectorAll('.mode-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mode === mode));
    document.getElementById('stockHelp').textContent = MODES[mode].help;
    document.getElementById('stockQtyLabel').textContent = MODES[mode].label;
    input.min = MODES[mode].min;
    input.value = MODES[mode].start;
    document.getElementById('stockReasonBox').classList.toggle('hidden', mode !== 'remove');
    update();
  }

  modalForm.querySelectorAll('.mode-tab').forEach(tab => tab.addEventListener('click', () => choose(tab.dataset.mode)));
  input.addEventListener('input', update);
  choose(mode);

  modalForm.onsubmit = async (e) => {
    e.preventDefault();
    const body = { mode, quantity: Number(input.value), note: document.getElementById('f_note').value.trim() };
    if (mode === 'remove') body.reason = document.getElementById('f_stock_reason').value;
    try {
      const res = await fetch(API.PRODUCTS + '/products/' + productId + '/stock-adjustment', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not change the stock.');
      closeModal();
      showToast(`Stock updated: ${data.previousStock} → ${data.newStock}`);
      loadInventory();
      loadNotifications(); // the bell may have a new low stock message
    } catch (err) {
      openPopup({ type: 'error', title: 'This could not be done', message: err.message, buttons: [{ text: 'OK', value: true }] });
    }
  };

  modalOverlay.classList.remove('hidden');
}

// ===========================================================
// ORDERS
// ===========================================================
// Which status changes the shop can make (cancelling has its own button, so the stock always goes back)
const ORDER_NEXT_STATUS = {
  pending: ['processing', 'shipped', 'completed'],
  processing: ['shipped', 'completed'],
  shipped: ['completed'],
  completed: [],
  cancelled: [],
};
const ADMIN_CANCEL_REASONS = ['Out of stock', 'Customer asked to cancel', 'Customer cannot be reached', 'Payment problem', 'Address problem', 'Other'];
const DECLINE_REASONS = ['The order is already packed', 'The order is already with the courier', 'Other'];
const NOTE_STYLE = 'font-size:12px; color:#666; margin-top:6px;';

function orderEsc(text) {
  return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The payment of an order in words: "GCash · Paid", "Cash on Delivery · Collect ₱665", and so on
function paymentLine(o) {
  const method = o.payment_method === 'gcash' ? 'GCash' : 'Cash on Delivery';
  const amount = '₱' + Number(o.total_amount).toLocaleString();
  const labels = {
    paid: ['Paid', '#27ae60'],
    awaiting_payment: ['Awaiting payment', '#b9770e'],
    refund_pending: ['Refund pending', '#e74c3c'],
    refunded: ['Refunded', '#666'],
    unpaid: o.payment_method === 'gcash' ? ['Not paid', '#666'] : [o.status === 'cancelled' ? 'Not collected' : 'Collect ' + amount + ' on delivery', '#b9770e'],
  };
  const [text, color] = labels[o.payment_status] || ['', '#666'];
  return `<div style="font-size:12px; margin-top:6px; color:${color};"><b>${method}</b> · ${orderEsc(text)}</div>`;
}

async function markRefunded(orderId) {
  if (!(await askConfirm('Mark this refund as done? Do this after you refunded the customer in your PayMongo dashboard.', 'Mark as refunded'))) return;
  if (await sendOrderAction('/orders/' + orderId + '/refunded', {})) {
    loadOrders();
    loadNotifications();
  }
}

// Loads the orders. When the Orders page is opened (resetFilters), the filters start empty again;
// after an action (ship, cancel...) the list is refreshed with the same filters.
async function loadOrders(resetFilters) {
  const tbody = document.getElementById('ordersTableBody');
  if (resetFilters) {
    // the filters are set at once (what the Dashboard chose, or empty), so the old list is never seen with the wrong filter
    resetOrderFilterInputs();
    if (ordersPreset) {
      if (ordersPreset.status) document.getElementById('orderStatusFilter').value = ordersPreset.status;
      if (ordersPreset.payment) document.getElementById('orderPaymentFilter').value = ordersPreset.payment;
      ordersPreset = null;
    }
    if (allOrders.length) renderOrders();
  }
  try {
    const res = await fetch(API.ORDERS + '/orders', { headers: authHeaders() });
    const orders = await res.json();
    if (!res.ok) throw new Error(orders.error || 'Could not load the orders.');
    ordersCache = Object.fromEntries(orders.map(o => [o.order_id, o]));
    allOrders = orders;
    renderOrders();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5">Cannot reach the order service. Please try again.</td></tr>';
  }
}

// ----- the filters of the Orders page -----
function pad2(n) { return String(n).padStart(2, '0'); }
function localDateKey(value) { const d = new Date(value); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function currentOrderFilters() {
  return {
    q: document.getElementById('orderSearch').value.toLowerCase().trim(),
    status: document.getElementById('orderStatusFilter').value,
    payment: document.getElementById('orderPaymentFilter').value,
    from: document.getElementById('orderFrom').value,
    to: document.getElementById('orderTo').value,
  };
}

function orderMatches(o, f) {
  if (f.status === 'cancel_requests') { if (o.cancel_request_status !== 'requested') return false; }
  else if (f.status !== 'all' && o.status !== f.status) return false;
  if (f.payment === 'ready' && o.payment_method === 'gcash' && o.payment_status === 'awaiting_payment') return false; // not waiting for its payment
  if (f.payment === 'cod' && o.payment_method !== 'cod') return false;
  if (f.payment === 'gcash' && o.payment_method !== 'gcash') return false;
  if (f.payment === 'awaiting' && !(o.payment_method === 'gcash' && o.payment_status === 'awaiting_payment')) return false;
  if (f.payment === 'refund_pending' && o.payment_status !== 'refund_pending') return false;
  if (f.payment === 'refunded' && o.payment_status !== 'refunded') return false;
  const day = localDateKey(o.order_date);
  if (f.from && day < f.from) return false;
  if (f.to && day > f.to) return false;
  if (f.q) {
    const text = [o.order_code, '#' + o.order_id, o.customer_name, o.items_summary, o.courier, o.tracking_number].join(' ').toLowerCase();
    if (!text.includes(f.q)) return false;
  }
  return true;
}

function resetOrderFilterInputs() {
  document.getElementById('orderSearch').value = '';
  document.getElementById('orderStatusFilter').value = 'all';
  document.getElementById('orderPaymentFilter').value = 'all';
  document.getElementById('orderFrom').value = '';
  document.getElementById('orderTo').value = '';
}

// the status choices show how many orders each one has
function updateOrderStatusCounts() {
  const box = document.getElementById('orderStatusFilter');
  const count = (test) => allOrders.filter(test).length;
  const labels = {
    all: `All statuses (${allOrders.length})`,
    pending: `Pending (${count(o => o.status === 'pending')})`,
    processing: `Processing (${count(o => o.status === 'processing')})`,
    shipped: `Shipped (${count(o => o.status === 'shipped')})`,
    completed: `Completed (${count(o => o.status === 'completed')})`,
    cancelled: `Cancelled (${count(o => o.status === 'cancelled')})`,
    cancel_requests: `Cancel requests (${count(o => o.cancel_request_status === 'requested')})`,
  };
  Array.from(box.options).forEach(option => { option.textContent = labels[option.value]; });
}

function renderOrders() {
  const tbody = document.getElementById('ordersTableBody');
  const filters = currentOrderFilters();
  updateOrderStatusCounts();
  const list = allOrders.filter(o => orderMatches(o, filters));

    tbody.innerHTML = list.map(o => {
      const next = ORDER_NEXT_STATUS[o.status] || [];
      // a GCash order cannot move forward until the payment is received
      const awaitingPayment = o.status === 'pending' && o.payment_method === 'gcash' && o.payment_status === 'awaiting_payment';
      const statusControl = next.length && !awaitingPayment
        ? `<select class="status-select" onchange="updateOrderStatus(${o.order_id}, this.value)">
             <option value="${o.status}" selected>${o.status}</option>
             ${next.map(s => `<option value="${s}">${s}</option>`).join('')}
           </select>`
        : `<span class="badge badge-${o.status}">${o.status}</span>`;

      let note = '';
      if (o.status === 'cancelled') {
        note = `<div style="${NOTE_STYLE}">Cancelled by ${o.cancelled_by === 'admin' ? 'the shop' : o.cancelled_by === 'system' ? 'the system' : 'the customer'}: ${orderEsc(o.cancel_reason || 'no reason given')}</div>`;
      } else if (o.cancel_request_status === 'requested') {
        note = `<div style="${NOTE_STYLE} color:#b9770e;">Customer asks to cancel: ${orderEsc(o.cancel_request_reason)}
          <div style="margin-top:4px;">
            <button class="icon-btn" onclick="approveCancelRequest(${o.order_id})">Approve</button>
            <button class="icon-btn danger" onclick="openDeclineModal(${o.order_id})">Decline</button>
          </div></div>`;
      } else if (o.cancel_request_status === 'rejected') {
        note = `<div style="${NOTE_STYLE}">Cancel request declined: ${orderEsc(o.cancel_reject_reason)}</div>`;
      }

      const shipNote = o.courier
        ? `<div style="${NOTE_STYLE}">Shipped via <b>${orderEsc(o.courier)}</b>${o.tracking_number ? ' · ' + orderEsc(o.tracking_number) : ''}
            ${o.status === 'shipped' ? `<button class="icon-btn" onclick="openShipModal(${o.order_id}, true)">Edit tracking</button>` : ''}</div>`
        : '';
      const refundButton = o.payment_status === 'refund_pending'
        ? `<div style="margin-top:4px;"><button class="icon-btn" onclick="markRefunded(${o.order_id})">Mark as refunded</button></div>`
        : '';
      const slipButton = o.status !== 'cancelled'
        ? `<div style="margin-top:4px;"><button class="icon-btn" onclick="printPackingSlip(${o.order_id})">Print slip</button></div>`
        : '';

      const canCancel = ['pending', 'processing', 'shipped'].includes(o.status) && o.cancel_request_status !== 'requested';
      const cancelButton = canCancel
        ? `<div style="margin-top:4px;"><button class="icon-btn danger" onclick="openCancelModal(${o.order_id})">Cancel order</button></div>`
        : '';

      return `
      <tr>
        <td><button type="button" class="link-btn order-code" onclick="openOrderDetails(${o.order_id})">${orderEsc(o.order_code || '#' + o.order_id)}</button>${o.items_summary ? `<div class="muted-small">${orderEsc(o.items_summary)}</div>` : ''}</td>
        <td>${o.user_id ? `<button type="button" class="link-btn" onclick="openCustomerDetails(${o.user_id})">${orderEsc(o.customer_name || 'N/A')}</button>` : orderEsc(o.customer_name || 'N/A')}</td>
        <td>₱${Number(o.total_amount).toLocaleString()}</td>
        <td>${statusControl}${paymentLine(o)}${shipNote}${note}${refundButton}${cancelButton}${slipButton}</td>
        <td>${new Date(o.order_date).toLocaleDateString()}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="5">${allOrders.length ? 'No orders match these filters.' : 'No orders yet.'}</td></tr>`;

  const filtered = list.length !== allOrders.length;
  document.getElementById('orderCount').textContent = allOrders.length
    ? `Showing ${list.length} of ${allOrders.length} order${allOrders.length === 1 ? '' : 's'}${filtered ? ' (filtered)' : ''}`
    : '';
}

// ----- CSV files (Excel can open them) -----
// A cell of a CSV file. Text that Excel could read as a formula (it starts with = + - @) is made safe.
function csvText(value) {
  let text = String(value == null ? '' : value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
const csvNumber = (value) => (value == null || value === '' || Number.isNaN(Number(value)) ? '' : String(Math.round(Number(value) * 100) / 100));

function downloadFile(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const PAYMENT_WORDS = { cod: 'Cash on Delivery', gcash: 'GCash' };
const PAYMENT_STATUS_WORDS = { unpaid: 'Unpaid', awaiting_payment: 'Awaiting payment', paid: 'Paid', refund_pending: 'Refund pending', refunded: 'Refunded' };

// Saves the orders that are shown now (with the filters) as a CSV file
function exportOrdersCsv() {
  const list = allOrders.filter(o => orderMatches(o, currentOrderFilters()));
  if (list.length === 0) { showToast('There are no orders to export.', true); return; }
  const lines = [['Order code', 'Date', 'Customer', 'Items', 'Subtotal', 'Shipping fee', 'Shipping discount', 'Total', 'Payment method', 'Payment status', 'Order status', 'Courier', 'Tracking number'].join(',')];
  for (const o of list) {
    const d = new Date(o.order_date);
    lines.push([
      csvText(o.order_code || '#' + o.order_id),
      csvText(`${localDateKey(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`),
      csvText(o.customer_name || ''),
      csvText(o.items_summary || ''),
      csvNumber(o.subtotal_amount != null ? o.subtotal_amount : o.total_amount),
      csvNumber(o.shipping_fee),
      csvNumber(o.shipping_discount),
      csvNumber(o.total_amount),
      csvText(PAYMENT_WORDS[o.payment_method] || o.payment_method || ''),
      csvText(PAYMENT_STATUS_WORDS[o.payment_status] || o.payment_status || ''),
      csvText(o.status ? o.status.charAt(0).toUpperCase() + o.status.slice(1) : ''),
      csvText(o.courier || ''),
      csvText(o.tracking_number || ''),
    ].join(','));
  }
  downloadFile(`fitora-orders_${localDateKey(new Date())}.csv`, new Blob(['\uFEFF' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }));
  showToast(`${list.length} order${list.length === 1 ? '' : 's'} saved to a CSV file.`);
}

// Sends one of the order actions and shows the server's message if it is refused
async function sendOrderAction(path, body) {
  try {
    const res = await fetch(API.ORDERS + path, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Could not complete this action.');
      return false;
    }
    return true;
  } catch (err) {
    alert('Cannot reach the order service. Please try again.');
    return false;
  }
}

async function updateOrderStatus(orderId, status) {
  if (status === 'shipped') {
    loadOrders(); // put the dropdown back to the current status
    openShipModal(orderId, false); // shipping needs the courier and the tracking number
    return;
  }
  await sendOrderAction('/orders/' + orderId + '/status', { status });
  loadOrders();
  loadNotifications(); // refresh the bell, the number of pending orders may have changed
}

const COURIERS = ['J&T Express', 'LBC Express', 'Flash Express', 'SPX Express', 'Ninja Van', 'Own rider / own delivery', 'Other'];
let ordersCache = {}; // the orders on screen, so the Edit tracking window can show the saved details

// Window for the courier and the tracking number. This is how an order becomes "shipped".
function openShipModal(orderId, editing) {
  const current = ordersCache[orderId] || {};
  modalTitle.textContent = editing ? `Edit tracking for order #${orderId}` : `Ship order #${orderId}`;
  modalForm.innerHTML = `
    <p style="font-size:13px; color:#666; margin-bottom:6px;">The customer will see this in the app and will get an email.</p>
    <label>Courier</label>
    <select id="f_courier">${COURIERS.map(c => `<option value="${orderEsc(c)}" ${c === (current.courier || 'J&T Express') ? 'selected' : ''}>${orderEsc(c)}</option>`).join('')}</select>
    <label>Tracking number</label>
    <input type="text" id="f_tracking" maxlength="40" placeholder="e.g. 8001234567" value="${orderEsc(current.tracking_number || '')}">
    <div class="modal-actions">
      <button type="button" class="secondary-btn" onclick="closeModal()">Back</button>
      <button type="submit" class="primary-btn">${editing ? 'Save' : 'Mark as shipped'}</button>
    </div>
  `;
  modalForm.onsubmit = async (e) => {
    e.preventDefault();
    const body = { courier: document.getElementById('f_courier').value, tracking_number: document.getElementById('f_tracking').value.trim() };
    const path = editing ? '/orders/' + orderId + '/shipping-info' : '/orders/' + orderId + '/ship';
    if (await sendOrderAction(path, body)) {
      closeModal();
      loadOrders();
      loadNotifications();
    }
  };
  modalOverlay.classList.remove('hidden');
}

// Opens a printable packing slip: who to send it to, what is inside, and the shipping details
async function printPackingSlip(orderId) {
  let order;
  try {
    const res = await fetch(API.ORDERS + '/orders/' + orderId, { headers: authHeaders() });
    order = await res.json();
    if (!res.ok) throw new Error(order.error || 'Could not load the order.');
  } catch (err) {
    alert(err.message);
    return;
  }

  const win = window.open('', '_blank', 'width=720,height=900');
  if (!win) {
    alert('Please allow pop-ups for this website to print the packing slip.');
    return;
  }
  const logo = new URL('logo.png', window.location.href).href;
  const money = (n) => '₱' + Number(n).toLocaleString();
  const address = order.ship_street
    ? `<b>${orderEsc(order.ship_name)}</b><br>${orderEsc(order.ship_phone)}<br>${orderEsc(order.ship_street)}<br>Brgy. ${orderEsc(order.ship_barangay)}, ${orderEsc(order.ship_city)}<br>${orderEsc(order.ship_province)}, ${orderEsc(order.ship_region)} ${orderEsc(order.ship_zip)}${order.ship_landmark ? '<br>Landmark: ' + orderEsc(order.ship_landmark) : ''}`
    : orderEsc(order.shipping_address || 'No address provided.');
  const items = (order.items || []).map(i => `<tr><td>${i.quantity}</td><td>${orderEsc(i.product_name)}</td><td class="right">${money(i.price * i.quantity)}</td></tr>`).join('');
  const totals = order.subtotal_amount != null
    ? `<tr><td colspan="2">Subtotal</td><td class="right">${money(order.subtotal_amount)}</td></tr>
       <tr><td colspan="2">Shipping fee</td><td class="right">${money(order.shipping_fee)}</td></tr>
       ${Number(order.shipping_discount) > 0 ? `<tr><td colspan="2">Shipping discount</td><td class="right">-${money(order.shipping_discount)}</td></tr>` : ''}`
    : '';
  const courier = order.courier
    ? `<p><b>Courier:</b> ${orderEsc(order.courier)}${order.tracking_number ? ' &nbsp; <b>Tracking:</b> ' + orderEsc(order.tracking_number) : ''}</p>`
    : '';

  const paymentBox = order.payment_method === 'gcash'
    ? (order.payment_status === 'paid'
        ? '<div class="pay paid">PAID via GCash<br><span>Do not collect any payment</span></div>'
        : '<div class="pay">GCash payment not received yet</div>')
    : `<div class="pay cod">CASH ON DELIVERY<br><span>Collect ${money(order.total_amount)} from the customer</span></div>`;

  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Packing slip - Order ${orderEsc(order.order_code || '#' + order.order_id)}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #111; padding: 28px; font-size: 14px; }
      .head { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #fc408c; padding-bottom: 12px; margin-bottom: 18px; }
      .head img { width: 64px; height: 64px; border-radius: 50%; }
      .head h1 { margin: 0; font-size: 22px; } .head p { margin: 2px 0 0; color: #666; }
      .shipto { border: 2px dashed #111; border-radius: 8px; padding: 14px; margin: 14px 0; font-size: 16px; line-height: 1.5; }
      .label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      td, th { padding: 8px 6px; border-bottom: 1px solid #ddd; text-align: left; } th { font-size: 12px; text-transform: uppercase; color: #666; }
      .right { text-align: right; } .total td { font-weight: bold; font-size: 16px; border-top: 2px solid #111; }
      .pay { border: 2px solid #111; border-radius: 8px; padding: 10px 14px; margin: 12px 0; font-weight: bold; font-size: 16px; text-align: center; }
      .pay span { font-weight: normal; font-size: 13px; } .pay.cod { background: #fff0f6; border-color: #fc408c; } .pay.paid { background: #eafaf0; border-color: #27ae60; }
      .foot { margin-top: 28px; color: #666; font-size: 12px; text-align: center; }
    </style></head><body>
      <div class="head"><img src="${logo}" alt=""><div><h1>Fitora Gear</h1><p>Packing slip</p></div></div>
      <p><b>Order ${orderEsc(order.order_code || '#' + order.order_id)}</b> &nbsp; ${new Date(order.order_date).toLocaleString()}</p>
      ${courier}
      ${paymentBox}
      <div class="label">Ship to</div>
      <div class="shipto">${address}</div>
      <div class="label">Items</div>
      <table><tr><th>Qty</th><th>Item</th><th class="right">Price</th></tr>${items}${totals}
        <tr class="total"><td colspan="2">Total</td><td class="right">${money(order.total_amount)}</td></tr></table>
      <p class="foot">Thank you for shopping with Fitora Gear!</p>
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

// A small window with a list of reasons (used for cancelling and for declining a request)
function openReasonModal(title, intro, reasons, buttonText, onSubmit) {
  document.querySelector('#modalOverlay .modal').classList.remove('modal-wide');
  modalTitle.textContent = title;
  modalForm.innerHTML = `
    <p style="font-size:13px; color:#666; margin-bottom:6px;">${intro}</p>
    <label>Reason</label>
    <select id="f_reason">${reasons.map(r => `<option value="${orderEsc(r)}">${orderEsc(r)}</option>`).join('')}</select>
    <div class="modal-actions">
      <button type="button" class="secondary-btn" onclick="closeModal()">Back</button>
      <button type="submit" class="primary-btn">${buttonText}</button>
    </div>
  `;
  modalForm.onsubmit = async (e) => {
    e.preventDefault();
    await onSubmit(document.getElementById('f_reason').value);
  };
  modalOverlay.classList.remove('hidden');
}

function openCancelModal(orderId) {
  openReasonModal(
    `Cancel order #${orderId}`,
    'The customer will see the reason, and the items go back to stock.',
    ADMIN_CANCEL_REASONS,
    'Cancel order',
    async (reason) => {
      if (await sendOrderAction('/orders/' + orderId + '/cancel', { reason })) {
        closeModal();
        loadOrders();
        loadNotifications();
      }
    }
  );
}

async function approveCancelRequest(orderId) {
  if (!(await askConfirm('Approve this cancellation? The items will go back to stock.', 'Approve'))) return;
  if (await sendOrderAction('/orders/' + orderId + '/cancel-request', { decision: 'approve' })) {
    loadOrders();
    loadNotifications();
  }
}

function openDeclineModal(orderId) {
  openReasonModal(
    `Decline the cancellation of order #${orderId}`,
    'The order stays active. The customer will see the reason.',
    DECLINE_REASONS,
    'Decline request',
    async (reason) => {
      if (await sendOrderAction('/orders/' + orderId + '/cancel-request', { decision: 'reject', reason })) {
        closeModal();
        loadOrders();
        loadNotifications();
      }
    }
  );
}

// ===========================================================
// SALES REPORTS
// ===========================================================
function niceDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// The first and last day of a ready-made period (the days of this computer, which is Philippine time)
function presetRange(preset) {
  const today = new Date();
  const back = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return localDateKey(d); };
  if (preset === 'today') return { from: localDateKey(today), to: localDateKey(today) };
  if (preset === '7') return { from: back(6), to: localDateKey(today) };
  if (preset === '30') return { from: back(29), to: localDateKey(today) };
  if (preset === 'year') return { from: back(364), to: localDateKey(today) };
  if (preset === 'month') return { from: localDateKey(new Date(today.getFullYear(), today.getMonth(), 1)), to: localDateKey(today) };
  if (preset === 'lastmonth') return { from: localDateKey(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: localDateKey(new Date(today.getFullYear(), today.getMonth(), 0)) };
  return null;
}

function syncReportToolbar() {
  document.querySelectorAll('#reportRanges .chip').forEach(chip => chip.classList.toggle('active', chip.dataset.range === reportState.preset));
  document.getElementById('reportCustom').classList.toggle('hidden', reportState.preset !== 'custom');
  document.getElementById('reportFrom').value = reportState.from;
  document.getElementById('reportTo').value = reportState.to;
  document.getElementById('reportRangeLabel').textContent = reportState.from === reportState.to
    ? niceDay(reportState.from)
    : `${niceDay(reportState.from)} - ${niceDay(reportState.to)}`;
}

function choosePreset(preset) {
  if (preset === 'custom') {
    reportState.preset = 'custom';
    syncReportToolbar();
    return;
  }
  const range = presetRange(preset);
  Object.assign(reportState, { preset, from: range.from, to: range.to });
  syncReportToolbar();
  fetchReport();
}

function applyCustomRange() {
  const from = document.getElementById('reportFrom').value;
  const to = document.getElementById('reportTo').value;
  if (!from || !to) { showToast('Please choose the start date and the end date.', true); return; }
  if (from > to) { showToast('The start date must not be after the end date.', true); return; }
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  if (days > 366) { showToast('Please choose a period of at most 1 year.', true); return; }
  Object.assign(reportState, { preset: 'custom', from, to });
  syncReportToolbar();
  fetchReport();
}

async function loadReports() {
  if (!reportState.from) Object.assign(reportState, { preset: '7' }, presetRange('7'));
  syncReportToolbar();
  await fetchReport();
}

async function fetchReport() {
  const mine = ++reportRequest; // if the answer of an older choice arrives late, it is ignored
  try {
    const res = await fetch(`${API.ORDERS}/orders/reports/overview?from=${reportState.from}&to=${reportState.to}`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load the report.');
    if (mine !== reportRequest) return;
    renderReport(data);
  } catch (err) {
    if (mine === reportRequest) showToast(err.message, true);
  }
}

function peso0(n) { const v = Number(n || 0); return '₱' + v.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }); } // whole pesos without decimals, money with cents always with 2

// a list where every line has a bar showing its share
function meterList(rows, empty) {
  if (!rows.length) return `<li>${empty}</li>`;
  const max = Math.max(...rows.map(r => r.value), 1);
  return rows.map(r => `
    <li class="meter-row">
      <div class="meter-text"><span>${orderEsc(r.label)}</span><span>${orderEsc(r.text)}</span></div>
      <div class="meter"><i class="${r.tone || ''}" style="width:${Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0)}%"></i></div>
    </li>`).join('');
}

function renderReport(data) {
  const s = data.summary;
  document.getElementById('reportTotalRevenue').textContent = peso0(s.revenue);
  document.getElementById('reportOrders').textContent = s.orders.toLocaleString();
  document.getElementById('reportCompletedOrders').textContent = s.completedOrders.toLocaleString();
  document.getElementById('reportCancelled').textContent = s.cancelledOrders.toLocaleString();
  document.getElementById('reportItemsSold').textContent = s.itemsSold.toLocaleString();
  document.getElementById('reportAvgOrder').textContent = peso0(s.avgOrderValue);

  renderSalesChart(data.byDay);
  document.getElementById('reportEmpty').classList.toggle('hidden', s.orders + s.cancelledOrders > 0);

  document.getElementById('bestSellersList').innerHTML = data.bestSellers.map((p, i) =>
    `<li><span><b class="rank">${i + 1}</b> ${orderEsc(p.product_name)}</span><span>${p.totalSold} sold · ${peso0(p.totalRevenue)}</span></li>`
  ).join('') || '<li>No sales in this period.</li>';

  document.getElementById('categoryRevenueList').innerHTML = meterList(
    data.byCategory.map(c => ({ label: c.category_name, text: peso0(c.revenue), value: c.revenue })), 'No sales in this period.');

  const statusLabels = { pending: 'Pending', processing: 'Processing', shipped: 'Shipped', completed: 'Completed', cancelled: 'Cancelled' };
  document.getElementById('statusBreakdown').innerHTML = meterList(
    Object.keys(statusLabels).map(k => ({ label: statusLabels[k], text: String(data.byStatus[k]), value: data.byStatus[k], tone: k === 'cancelled' ? 'meter-red' : '' })),
    'No orders in this period.');

  const paymentLabels = { cod: 'Cash on Delivery', gcash: 'GCash' };
  document.getElementById('paymentBreakdown').innerHTML = meterList(
    data.byPayment.map(p => ({ label: paymentLabels[p.method], text: `${p.orders} order${p.orders === 1 ? '' : 's'} · ${peso0(p.revenue)}`, value: p.revenue })),
    'No orders in this period.');
}

// Bars for every day of the period (no chart library)
function renderSalesChart(byDay) {
  const chart = document.getElementById('salesChart');
  const count = byDay.length;
  const max = Math.max(...byDay.map(d => d.revenue), 1);
  const step = count <= 14 ? 1 : Math.ceil(count / 12); // with many days, only some of the names are written
  chart.classList.toggle('dense', count > 14);
  chart.innerHTML = byDay.map((d, i) => {
    const [y, m, day] = d.day.split('-').map(Number);
    const date = new Date(y, m - 1, day);
    const label = count <= 7
      ? date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
      : count <= 31 ? String(day) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const heightPct = d.revenue > 0 ? Math.max((d.revenue / max) * 100, 3) : 1;
    return `
      <div class="bar-col" title="${orderEsc(niceDay(d.day))}: ${orderEsc(peso0(d.revenue))} (${d.orders} order${d.orders === 1 ? '' : 's'})">
        <div class="bar-value">${count <= 10 && d.revenue > 0 ? peso0(d.revenue) : ''}</div>
        <div class="bar ${d.revenue === 0 ? 'bar-empty' : ''}" style="height:${heightPct}%"></div>
        <div class="bar-label">${i % step === 0 ? orderEsc(label) : ''}</div>
      </div>`;
  }).join('');
}

// Downloads the CSV file of the orders of the chosen period (made by the server)
async function exportReportCsv() {
  try {
    const res = await fetch(`${API.ORDERS}/orders/reports/export?from=${reportState.from}&to=${reportState.to}`, { headers: authHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Could not make the CSV file.');
    }
    downloadFile(`fitora-orders_${reportState.from}_to_${reportState.to}.csv`, await res.blob());
    showToast('The CSV file was saved.');
  } catch (err) {
    showToast(err.message, true);
  }
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
    tbody.innerHTML = '<tr><td colspan="6">Cannot reach the auth service. Please try again.</td></tr>';
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

  tbody.innerHTML = list.map(c => {
    const status = c.account_status || (c.is_active ? 'active' : 'suspended');
    const name = orderEsc(c.full_name);
    const actions = status === 'active'
      ? `<button class="icon-btn danger" data-name="${name}" onclick="suspendCustomer(${c.user_id}, this.dataset.name)">Suspend</button>
         <button class="icon-btn danger" data-name="${name}" onclick="banCustomer(${c.user_id}, this.dataset.name)">Ban</button>`
      : `<button class="icon-btn" data-name="${name}" onclick="reactivateCustomer(${c.user_id}, this.dataset.name)">Reactivate</button>`;
    return `
    <tr>
      <td><button type="button" class="link-btn" onclick="openCustomerDetails(${c.user_id})">${name}</button></td>
      <td>${orderEsc(c.email)}</td>
      <td>${orderEsc(c.phone || '-')}</td>
      <td>${c.order_count}</td>
      <td><span class="badge badge-${orderEsc(status)}">${orderEsc(status)}</span>${c.status_reason && status !== 'active' ? `<div class="muted-small">${orderEsc(c.status_reason)}</div>` : ''}</td>
      <td>
        <button class="icon-btn" onclick="openCustomerDetails(${c.user_id})">View</button>
        ${actions}
        <button class="icon-btn danger" data-name="${name}" onclick="deleteCustomer(${c.user_id}, this.dataset.name)">Delete</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="6">No registered customers yet.</td></tr>';
}

// ---------- suspend, ban, reactivate, delete ----------
const CUSTOMER_STATUS_REASONS = ['Suspicious activity', 'Fake orders or non-payment', 'Abusive behavior', 'Violated the shop policy', 'Requested by the customer', 'Other'];

async function sendCustomerAction(userId, method, path, body) {
  try {
    const res = await fetch(API.AUTH + '/customers/' + userId + path, { method, headers: authHeaders(), body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      openPopup({ type: 'error', title: 'This could not be done', message: data.error || 'Could not complete this action.', buttons: [{ text: 'OK', value: true }] });
      return null;
    }
    return data;
  } catch (err) {
    openPopup({ type: 'error', title: 'Something went wrong', message: 'Cannot reach the auth service. Please try again.', buttons: [{ text: 'OK', value: true }] });
    return null;
  }
}

// after a change: refresh the table, and show the customer window again if the change was made from there
function afterCustomerChange(userId, fromDetails) {
  loadCustomers();
  if (fromDetails) openCustomerDetails(userId);
}

function suspendCustomer(userId, name, fromDetails) {
  openReasonModal(`Suspend ${name}`, 'The customer cannot log in or place orders while suspended, and the reason is shown to them. You can reactivate the account at any time.',
    CUSTOMER_STATUS_REASONS, 'Suspend', async (reason) => {
      if (await sendCustomerAction(userId, 'PUT', '/status', { status: 'suspended', reason })) {
        closeModal();
        afterCustomerChange(userId, fromDetails);
      }
    });
}

function banCustomer(userId, name, fromDetails) {
  openReasonModal(`Ban ${name}`, 'A banned customer cannot log in or place orders, and the reason is shown to them. Use this for serious cases. You can still reactivate the account later.',
    CUSTOMER_STATUS_REASONS, 'Ban', async (reason) => {
      if (await sendCustomerAction(userId, 'PUT', '/status', { status: 'banned', reason })) {
        closeModal();
        afterCustomerChange(userId, fromDetails);
      }
    });
}

async function reactivateCustomer(userId, name, fromDetails) {
  if (!(await askConfirm(`Reactivate ${name}? They will be able to log in and place orders again.`, 'Reactivate'))) return;
  if (await sendCustomerAction(userId, 'PUT', '/status', { status: 'active' })) afterCustomerChange(userId, fromDetails);
}

async function deleteCustomer(userId, name) {
  if (!(await askConfirm(`Delete ${name}? The account is removed. Their past orders stay in your sales records, but their personal details are erased. This cannot be undone.`))) return;
  const data = await sendCustomerAction(userId, 'DELETE', '');
  if (!data) return;
  closeModal();
  await loadCustomers(); // the table is updated first, then the message
  openPopup({ type: 'success', title: 'Customer deleted', message: data.message, buttons: [{ text: 'OK', value: true }] });
}

// ===========================================================
// NOTIFICATIONS (bell icon - low stock + pending orders)
// ===========================================================
// ===========================================================
// NOTIFICATIONS (the bell)
// They are saved on the server and they stay, even after the order was processed.
// A notification glows until THIS admin opens it. Pressing one goes straight to the order / product.
// ===========================================================
let notificationItems = [];
const NOTIF_PAGES = { new_message: 'messages', new_order: 'orders', payment: 'orders', cancel_request: 'orders', order_cancelled: 'orders', refund: 'orders', low_stock: 'inventory', new_review: 'reviews', product_approval: 'products', product_decision: 'products' };
const NOTIF_TABLES = { orders: 'ordersTableBody', inventory: 'inventoryTableBody', reviews: 'reviewsTableBody', products: 'productsTableBody' };

function timeAgo(value) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const minutes = Math.floor(Math.max(0, Date.now() - time) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes + ' min ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  const days = Math.floor(hours / 24);
  if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
  return new Date(value).toLocaleDateString();
}

async function loadNotifications() {
  try {
    const res = await fetch(API.ORDERS + '/notifications', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load the notifications.');
    notificationItems = data.items;

    const badge = document.getElementById('notifBadge');
    badge.textContent = data.unread > 99 ? '99+' : data.unread;
    badge.classList.toggle('hidden', data.unread === 0);
    document.getElementById('notifBtn').classList.toggle('has-unread', data.unread > 0);
    document.getElementById('notifReadAll').classList.toggle('hidden', data.unread === 0);

    document.getElementById('notifList').innerHTML = data.items.map(n => `
      <li class="notif-item ${n.is_read ? 'read' : 'unread'}" data-id="${n.notification_id}">
        <span class="notif-icon" data-type="${orderEsc(n.type)}"></span>
        <span class="notif-body">
          <span class="notif-title">${orderEsc(n.title)}</span>
          <span class="notif-text">${orderEsc(n.message)}</span>
          <span class="notif-time">${orderEsc(timeAgo(n.created_at))}</span>
        </span>
        ${n.is_read ? '' : '<span class="notif-dot"></span>'}
      </li>`).join('') || '<li class="notif-empty">You are all caught up. New orders and updates will appear here.</li>';
  } catch (err) {
    console.error(err);
  }
}

// Flashes the row of the order / product in the table, once the table has been loaded
function highlightRow(tbodyId, text) {
  if (!text) return;
  const tbody = document.getElementById(tbodyId);
  let loaded = false;
  let done = false;
  const tryOnce = () => {
    if (done || !loaded) return;
    const row = Array.from(tbody.querySelectorAll('tr')).find(tr => tr.textContent.includes(text));
    if (!row) return;
    done = true;
    observer.disconnect();
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.remove('row-flash');
    void row.offsetWidth;
    row.classList.add('row-flash');
    setTimeout(() => row.classList.remove('row-flash'), 3400);
  };
  // the table is drawn again when its data arrives: flash after that
  const observer = new MutationObserver(() => { loaded = true; setTimeout(tryOnce, 60); });
  observer.observe(tbody, { childList: true });
  setTimeout(() => { loaded = true; tryOnce(); observer.disconnect(); }, 2500); // in case nothing changed
}

async function openNotification(id) {
  const item = notificationItems.find(n => n.notification_id === id);
  if (!item) return;
  document.getElementById('notifDropdown').classList.add('hidden');
  if (!item.is_read) {
    item.is_read = true;
    fetch(API.ORDERS + '/notifications/' + id + '/read', { method: 'POST', headers: authHeaders() }).then(loadNotifications).catch(() => {});
  }
  const page = NOTIF_PAGES[item.type];
  if (!page) return;
  if (item.type === 'product_approval') productsPreset = 'pending'; // the Super Admin lands on the products that wait for the decision
  history.replaceState(null, '', '#' + page);
  navigateTo(page);
  if (NOTIF_TABLES[page]) highlightRow(NOTIF_TABLES[page], item.ref_text);
}

document.getElementById('notifList').addEventListener('click', (e) => {
  const li = e.target.closest('.notif-item');
  if (li) openNotification(Number(li.dataset.id));
});

document.getElementById('notifReadAll').addEventListener('click', async (e) => {
  e.stopPropagation();
  try {
    await fetch(API.ORDERS + '/notifications/read-all', { method: 'POST', headers: authHeaders() });
  } catch (err) {
    console.error(err);
  }
  loadNotifications();
});

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
// DETAILS WINDOWS: one order, or one customer (with all their orders)
// The two can open each other, and a Back button returns to the one before.
// ===========================================================
const peso = (n) => '₱' + Number(n || 0).toLocaleString();

function productPicture(url, extraClass) {
  const placeholder = `<div class="thumb-placeholder ${extraClass || ''}">📦</div>`;
  if (!url) return placeholder;
  const src = url.includes('/image/upload/') ? url.replace('/image/upload/', '/image/upload/c_fill,w_120,h_120,q_auto/') : url;
  return `<img src="${orderEsc(src)}" class="thumb ${extraClass || ''}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'), {className:'thumb-placeholder ${extraClass || ''}', textContent:'📦'}))">`;
}

function avatarPicture(photo, name, big) {
  const initials = String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const size = big ? 'avatar-lg' : 'avatar-md';
  if (photo) {
    const src = photo.includes('/image/upload/') ? photo.replace('/image/upload/', '/image/upload/c_fill,w_160,h_160,q_auto/') : photo;
    return `<img src="${orderEsc(src)}" class="avatar ${size}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'), {className:'avatar ${size} avatar-initials', textContent:'${orderEsc(initials)}'}))">`;
  }
  return `<span class="avatar ${size} avatar-initials">${orderEsc(initials)}</span>`;
}

function paymentBadge(o) {
  const method = o.payment_method === 'gcash' ? 'GCash' : 'Cash on Delivery';
  const labels = { paid: ['Paid', 'paid'], awaiting_payment: ['Awaiting payment', 'pending'], refund_pending: ['Refund pending', 'cancelled'], refunded: ['Refunded', 'hidden'], unpaid: [o.payment_method === 'gcash' ? 'Not paid' : 'To be paid on delivery', ''] };
  const [text, kind] = labels[o.payment_status] || ['', ''];
  return `<span class="badge ${kind ? 'badge-' + kind : ''}">${orderEsc(method)} · ${orderEsc(text)}</span>`;
}

// Shows a wide window with the given content
function showDetails(title, html) {
  modalTitle.textContent = title;
  modalForm.innerHTML = html;
  modalForm.onsubmit = (e) => e.preventDefault();
  document.querySelector('#modalOverlay .modal').classList.add('modal-wide');
  modalOverlay.classList.remove('hidden');
}

function detailsError(title, message) {
  showDetails(title, `<p class="detail-error">${orderEsc(message)}</p><div class="modal-actions"><button type="button" class="secondary-btn" onclick="closeModal()">Close</button></div>`);
}

function backButton(back) {
  return back ? '<button type="button" class="back-link" id="detailBack">← Back</button>' : '';
}

async function openOrderDetails(orderId, back) {
  showDetails('Order details', '<p class="detail-loading">Loading...</p>');
  try {
    const res = await fetch(API.ORDERS + '/orders/' + orderId, { headers: authHeaders() });
    const o = await res.json();
    if (!res.ok) throw new Error(o.error || 'Could not load the order.');

    const code = o.order_code || '#' + o.order_id;
    const items = (o.items || []).map(i => `
      <div class="detail-item">
        ${productPicture(i.image)}
        <div class="detail-item-main">
          <button type="button" class="link-btn" data-product="${orderEsc(i.product_name || '')}">${orderEsc(i.product_name || 'Removed product')}</button>
          <div class="muted-small">${i.quantity} × ${peso(i.price)}</div>
        </div>
        <div class="detail-item-total">${peso(i.price * i.quantity)}</div>
      </div>`).join('') || '<p class="muted-small">No items.</p>';

    const address = o.ship_street
      ? `<b>${orderEsc(o.ship_name)}</b> · ${orderEsc(o.ship_phone)}<br>${orderEsc(o.ship_street)}<br>Brgy. ${orderEsc(o.ship_barangay)}, ${orderEsc(o.ship_city)}<br>${orderEsc(o.ship_province)}, ${orderEsc(o.ship_region)} ${orderEsc(o.ship_zip)}${o.ship_landmark ? `<br><span class="muted-small">Landmark: ${orderEsc(o.ship_landmark)}</span>` : ''}`
      : orderEsc(o.shipping_address || 'No address provided.');
    const shipping = o.courier
      ? `<div class="detail-line"><span>Courier</span><b>${orderEsc(o.courier)}${o.tracking_number ? ' · ' + orderEsc(o.tracking_number) : ''}</b></div>`
      : '';
    const totals = o.subtotal_amount != null
      ? `<div class="detail-line"><span>Subtotal</span><b>${peso(o.subtotal_amount)}</b></div>
         <div class="detail-line"><span>Shipping fee</span><b>${peso(o.shipping_fee)}</b></div>
         ${Number(o.shipping_discount) > 0 ? `<div class="detail-line"><span>Shipping discount</span><b class="text-success">-${peso(o.shipping_discount)}</b></div>` : ''}`
      : '';
    const cancelled = o.status === 'cancelled'
      ? `<div class="detail-note detail-note-danger">Cancelled by ${o.cancelled_by === 'admin' ? 'the shop' : o.cancelled_by === 'system' ? 'the system' : 'the customer'}: ${orderEsc(o.cancel_reason || 'no reason given')}</div>`
      : (o.cancel_request_status === 'requested' ? `<div class="detail-note">The customer asked to cancel: ${orderEsc(o.cancel_request_reason || '')}</div>` : '');

    showDetails('Order details', `
      ${backButton(back)}
      <div class="detail-top">
        <div>
          <div class="detail-code">${orderEsc(code)}</div>
          <div class="muted-small">${new Date(o.order_date).toLocaleString()}</div>
        </div>
        <div class="detail-badges"><span class="badge badge-${orderEsc(o.status)}">${orderEsc(o.status)}</span>${paymentBadge(o)}</div>
      </div>
      ${cancelled}
      <div class="detail-grid">
        <div class="detail-card">
          <div class="detail-label">Customer</div>
          <div class="detail-customer">
            ${avatarPicture(o.customer_photo, o.customer_name)}
            <div>
              ${o.user_id ? `<button type="button" class="link-btn" data-customer="${o.user_id}">${orderEsc(o.customer_name || 'N/A')}</button>` : orderEsc(o.customer_name || 'N/A')}
              <div class="muted-small">${orderEsc(o.email || '')}${o.customer_phone ? ' · ' + orderEsc(o.customer_phone) : ''}</div>
            </div>
          </div>
        </div>
        <div class="detail-card">
          <div class="detail-label">Delivery address</div>
          <div class="detail-address">${address}</div>
        </div>
      </div>
      <div class="detail-card">
        <div class="detail-label">Items</div>
        ${items}
        <div class="detail-totals">
          ${totals}
          ${shipping}
          <div class="detail-line detail-total"><span>Total</span><b>${peso(o.total_amount)}</b></div>
        </div>
      </div>
      <div class="modal-actions">
        ${o.status !== 'cancelled' ? `<button type="button" class="secondary-btn" onclick="printPackingSlip(${o.order_id})">Print slip</button>` : ''}
        <button type="button" class="primary-btn" onclick="closeModal()">Close</button>
      </div>`);

    if (back) document.getElementById('detailBack').addEventListener('click', back);
    modalForm.querySelectorAll('[data-product]').forEach(btn => btn.addEventListener('click', () => {
      closeModal();
      history.replaceState(null, '', '#products');
      navigateTo('products');
      highlightRow('productsTableBody', btn.dataset.product);
    }));
    modalForm.querySelectorAll('[data-customer]').forEach(btn => btn.addEventListener('click', () => {
      openCustomerDetails(Number(btn.dataset.customer), () => openOrderDetails(orderId, back));
    }));
  } catch (err) {
    detailsError('Order details', err.message);
  }
}

async function openCustomerDetails(userId, back) {
  showDetails('Customer details', '<p class="detail-loading">Loading...</p>');
  try {
    const [customerRes, ordersRes] = await Promise.all([
      fetch(API.AUTH + '/customers/' + userId, { headers: authHeaders() }),
      fetch(API.ORDERS + '/orders/customer/' + userId, { headers: authHeaders() }),
    ]);
    const c = await customerRes.json();
    if (!customerRes.ok) throw new Error(c.error || 'Could not load the customer.');
    const orders = ordersRes.ok ? await ordersRes.json() : [];
    const status = c.accountStatus || (c.isActive ? 'active' : 'suspended');
    const statusNote = status === 'deleted'
      ? '<div class="detail-note">This account was deleted. All personal details were erased; the past orders are kept for the records.</div>'
      : (status !== 'active' ? `<div class="detail-note detail-note-danger">This account is ${orderEsc(status)}${c.statusReason ? '. Reason: ' + orderEsc(c.statusReason) : ''}.</div>` : '');

    const birthday = c.birthday ? new Date(c.birthday + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '-';
    const addresses = (c.addresses || []).map(a => `
      <div class="detail-address-card">
        <div><span class="badge">${a.label === 'office' ? 'Office' : 'Home'}</span>${a.is_default ? ' <span class="badge badge-active">Default</span>' : ''}</div>
        <div><b>${orderEsc(a.recipient_name)}</b> · ${orderEsc(a.phone)}</div>
        <div>${orderEsc(a.street)}, Brgy. ${orderEsc(a.barangay_name)}, ${orderEsc(a.city_name)}, ${orderEsc(a.province_name)}, ${orderEsc(a.region_name)} ${orderEsc(a.zip_code)}</div>
        ${a.landmark ? `<div class="muted-small">Landmark: ${orderEsc(a.landmark)}</div>` : ''}
      </div>`).join('') || (c.address ? `<div class="detail-address-card">${orderEsc(c.address)}</div>` : '<p class="muted-small">No saved address.</p>');
    const orderRows = orders.map(o => `
      <button type="button" class="detail-order-row" data-order="${o.order_id}">
        <span class="detail-order-main"><b>${orderEsc(o.order_code || '#' + o.order_id)}</b><span class="muted-small">${orderEsc(o.items_summary || '')}</span></span>
        <span class="detail-order-side"><span class="badge badge-${orderEsc(o.status)}">${orderEsc(o.status)}</span><b>${peso(o.total_amount)}</b><span class="muted-small">${new Date(o.order_date).toLocaleDateString()}</span></span>
      </button>`).join('') || '<p class="muted-small">This customer has not ordered yet.</p>';

    showDetails('Customer details', `
      ${backButton(back)}
      <div class="detail-person">
        ${avatarPicture(c.profilePhoto, c.fullName, true)}
        <div class="detail-person-info">
          <div class="detail-code">${orderEsc(c.fullName)}</div>
          <div class="muted-small">@${orderEsc(c.username || '-')} · ${orderEsc(c.email)} ${c.emailVerified ? '<span class="badge badge-active">Email verified</span>' : '<span class="badge badge-pending">Email not verified</span>'}</div>
          <div style="margin-top:8px;"><span class="badge badge-${orderEsc(status)}">${orderEsc(status)}</span></div>
        </div>
      </div>
      ${statusNote}
      <div class="stat-tiles">
        <div class="stat-tile"><span>Orders</span><b>${c.stats.orders}</b></div>
        <div class="stat-tile"><span>Completed</span><b>${c.stats.completed}</b></div>
        <div class="stat-tile"><span>Cancelled</span><b>${c.stats.cancelled}</b></div>
        <div class="stat-tile"><span>Total spent</span><b>${peso(c.stats.spent)}</b></div>
      </div>
      <div class="detail-grid">
        <div class="detail-card">
          <div class="detail-label">Personal details</div>
          <div class="detail-line"><span>Phone</span><b>${orderEsc(c.phone || '-')}</b></div>
          <div class="detail-line"><span>Birthday</span><b>${orderEsc(birthday)}</b></div>
          <div class="detail-line"><span>Member since</span><b>${new Date(c.createdAt).toLocaleDateString()}</b></div>
        </div>
        <div class="detail-card">
          <div class="detail-label">Saved addresses</div>
          ${addresses}
        </div>
      </div>
      <div class="detail-card">
        <div class="detail-label">Orders</div>
        ${orderRows}
      </div>
      <div class="modal-actions detail-actions">
        ${status === 'deleted' ? '' : (status === 'active'
          ? '<button type="button" class="secondary-btn danger-outline" data-action="suspend">Suspend</button><button type="button" class="secondary-btn danger-outline" data-action="ban">Ban</button>'
          : '<button type="button" class="secondary-btn" data-action="reactivate">Reactivate</button>')}
        ${status === 'deleted' ? '' : '<button type="button" class="secondary-btn danger-outline" data-action="delete">Delete</button>'}
        <button type="button" class="primary-btn" onclick="closeModal()">Close</button>
      </div>`);

    if (back) document.getElementById('detailBack').addEventListener('click', back);
    modalForm.querySelectorAll('[data-order]').forEach(btn => btn.addEventListener('click', () => {
      openOrderDetails(Number(btn.dataset.order), () => openCustomerDetails(userId, back));
    }));
    modalForm.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'suspend') suspendCustomer(userId, c.fullName, true);
      if (action === 'ban') banCustomer(userId, c.fullName, true);
      if (action === 'reactivate') reactivateCustomer(userId, c.fullName, true);
      if (action === 'delete') deleteCustomer(userId, c.fullName);
    }));
  } catch (err) {
    detailsError('Customer details', err.message);
  }
}

// ===========================================================
// REVIEWS MANAGEMENT
// ===========================================================

async function loadReviews(resetFilter) {
  const tbody = document.getElementById('reviewsTableBody');
  if (resetFilter) {
    // the filter is set at once (what the Dashboard chose, or all)
    document.getElementById('reviewStatusFilter').value = reviewPreset || 'all';
    reviewPreset = null;
    if (allReviews.length) renderReviews();
  }
  try {
    const res = await fetch(API.PRODUCTS + '/reviews', { headers: authHeaders() });
    allReviews = await res.json();
    if (!res.ok) throw new Error(allReviews.error || 'Could not load the reviews.');
    renderReviews();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6">Cannot reach the product service. Please try again.</td></tr>';
  }
}

const REVIEW_LABELS = { pending: 'Pending', approved: 'Visible', hidden: 'Hidden' };

function renderReviews() {
  const tbody = document.getElementById('reviewsTableBody');
  const filterBox = document.getElementById('reviewStatusFilter');
  const filter = filterBox.value;

  // the filter shows how many reviews each choice has
  const count = (status) => allReviews.filter(r => r.status === status).length;
  filterBox.options[0].textContent = `All reviews (${allReviews.length})`;
  filterBox.options[1].textContent = `Waiting for approval (${count('pending')})`;
  filterBox.options[2].textContent = `Visible (${count('approved')})`;
  filterBox.options[3].textContent = `Hidden (${count('hidden')})`;

  const list = allReviews.filter(r => filter === 'all' || r.status === filter);
  tbody.innerHTML = list.map(r => {
    // the photos and the video the customer added (click to view them here, without leaving the page)
    const media = (r.media || []).map(m => {
      const isVideo = m.type === 'video';
      const picture = isVideo
        ? m.url.replace('/video/upload/', '/video/upload/so_0,c_fill,w_88,h_88,q_auto/').replace(/\.[A-Za-z0-9]+$/, '.jpg')
        : m.url.replace('/image/upload/', '/image/upload/c_fill,w_88,h_88,q_auto/');
      return `<a href="${orderEsc(m.url)}" class="review-media" data-url="${orderEsc(m.url)}" data-type="${isVideo ? 'video' : 'image'}" target="_blank" rel="noopener" title="${isVideo ? 'Play video' : 'View photo'}" style="position:relative; display:inline-block; margin:4px 6px 0 0;">
        <img src="${orderEsc(picture)}" alt="${isVideo ? 'Review video' : 'Review photo'}" style="width:44px; height:44px; object-fit:cover; border-radius:6px; display:block; background:#111;">
        ${isVideo ? '<span style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:16px; text-shadow:0 0 4px #000;">▶</span>' : ''}
      </a>`;
    }).join('');
    // pending: Approve or Hide.  Visible: Hide.  Hidden: Show.
    const buttons = r.status === 'approved'
      ? `<button class="icon-btn" onclick="updateReviewStatus(${r.review_id}, 'hidden')">Hide</button>`
      : r.status === 'hidden'
        ? `<button class="icon-btn" onclick="updateReviewStatus(${r.review_id}, 'approved')">Show</button>`
        : `<button class="icon-btn" onclick="updateReviewStatus(${r.review_id}, 'approved')">Approve</button>
           <button class="icon-btn" onclick="updateReviewStatus(${r.review_id}, 'hidden')">Hide</button>`;
    return `
    <tr data-review-id="${r.review_id}">
      <td>${orderEsc(r.product_name)}</td>
      <td>${orderEsc(r.customer_name)}</td>
      <td>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td>
      <td>${orderEsc(r.comment || '-')}${media ? `<div>${media}</div>` : ''}</td>
      <td><span class="badge badge-${orderEsc(r.status)}">${orderEsc(REVIEW_LABELS[r.status] || r.status)}</span></td>
      <td>
        ${buttons}
        <button class="icon-btn danger" onclick="deleteReview(${r.review_id})">Delete</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="6">${allReviews.length ? 'No reviews with this status.' : 'No reviews yet.'}</td></tr>`;

  // clicking a photo or the video opens the viewer
  tbody.onclick = (e) => {
    const link = e.target.closest('.review-media');
    if (link) {
      e.preventDefault();
      openMediaViewer(link.dataset.url, link.dataset.type);
    }
  };
}

async function updateReviewStatus(reviewId, status) {
  try {
    const res = await fetch(API.PRODUCTS + '/reviews/' + reviewId + '/status', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not change the review.');
    const review = allReviews.find(r => r.review_id === reviewId);
    if (review) review.status = status;
    renderReviews();
    showToast(status === 'hidden' ? 'Review hidden. Customers cannot see it.' : 'Review is now visible on the product page.');
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteReview(reviewId) {
  if (!(await askConfirm('Are you sure you want to delete this review?'))) return;
  await fetch(API.PRODUCTS + '/reviews/' + reviewId, { method: 'DELETE', headers: authHeaders() });
  loadReviews();
}

// ===========================================================
// ADMIN MANAGEMENT
// ===========================================================
let allAdmins = [];
// EDIT DITO: ito ang listahan ng mga pages na pwedeng bigyan ng access ang isang staff
const ADMIN_PERMISSION_OPTIONS = [
  ['products', 'Products'], ['categories', 'Categories'], ['inventory', 'Inventory'],
  ['customers', 'Customers'], ['orders', 'Orders'], ['reports', 'Sales Reports'], ['reviews', 'Reviews'],
];
const PERMISSION_LABELS = Object.fromEntries(ADMIN_PERMISSION_OPTIONS);

function showApiError(message, title) {
  openPopup({ type: 'error', title: title || 'This could not be done', message, buttons: [{ text: 'OK', value: true }] });
}

// "Online now", "Last seen 5 min ago", "Last login ...", or "Never logged in"
function adminPresence(a) {
  if (a.online) return 'Online now';
  if (a.last_seen_at) return 'Last seen ' + timeAgo(a.last_seen_at);
  if (a.last_login_at) return 'Last login ' + timeAgo(a.last_login_at);
  return 'Never logged in';
}

async function loadAdmins() {
  const tbody = document.getElementById('adminsTableBody');
  try {
    const res = await fetch(API.AUTH + '/admins', { headers: authHeaders() });
    allAdmins = await res.json();
    if (!res.ok) throw new Error(allAdmins.error || 'Could not load the admins.');
    const currentAdmin = getCurrentAdmin();

    tbody.innerHTML = allAdmins.map(a => {
      const isYou = currentAdmin && currentAdmin.id === a.admin_id;
      const inactive = a.is_active === 0;
      const permissions = (a.permissions || '').split(',').filter(Boolean);
      const access = a.role === 'super_admin'
        ? '<span class="badge badge-plain badge-active">Full access</span>'
        : (permissions.map(p => `<span class="pill">${orderEsc(PERMISSION_LABELS[p] || p)}</span>`).join('') || '<span class="muted-small">No sections yet</span>');
      const status = inactive
        ? '<span class="presence presence-inactive"><i></i>Inactive</span><div class="muted-small">Cannot log in</div>'
        : `<span class="presence ${a.online ? 'presence-online' : 'presence-offline'}"><i></i>${a.online ? 'Online' : 'Offline'}</span><div class="muted-small">${orderEsc(adminPresence(a))}</div>`;
      const actions = isYou
        ? '<button class="icon-btn" onclick="location.hash = \'profile\'">My profile</button>'
        : `<button class="icon-btn" onclick="openEditAdmin(${a.admin_id})">Edit</button>
           <button class="icon-btn" onclick="openResetPassword(${a.admin_id})">Reset password</button>
           ${inactive ? '' : `<button class="icon-btn" onclick="forceLogoutAdmin(${a.admin_id})">Log out</button>`}
           <button class="icon-btn ${inactive ? '' : 'danger'}" onclick="setAdminActive(${a.admin_id}, ${inactive ? 'true' : 'false'})">${inactive ? 'Activate' : 'Deactivate'}</button>
           <button class="icon-btn danger" onclick="deleteAdmin(${a.admin_id})">Delete</button>`;
      return `
      <tr data-admin-id="${a.admin_id}" class="${inactive ? 'row-inactive' : ''}">
        <td>
          <div class="inv-product">
            ${avatarPicture(a.profile_photo, a.full_name)}
            <div>
              <b>${orderEsc(a.full_name)}</b>${isYou ? ' <span class="badge badge-active">You</span>' : ''}
              <div class="muted-small">${orderEsc(a.email || 'No email')}${a.email ? (a.email_verified ? ' · verified' : ' · not verified') : ''}</div>
            </div>
          </div>
        </td>
        <td>@${orderEsc(a.username)}</td>
        <td>${a.role === 'super_admin' ? '<span class="badge badge-active">Super Admin</span>' : '<span class="badge">Staff</span>'}</td>
        <td>${status}</td>
        <td>${access}</td>
        <td>${actions}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6">No admins yet.</td></tr>';
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6">Cannot reach the auth service. Please try again.</td></tr>';
  }
}

// the "online" dots are refreshed every 20 seconds while the Admins page is open
setInterval(() => {
  if (!document.hidden && document.querySelector('#page-admins.active') && !document.querySelector('#modalOverlay:not(.hidden)')) loadAdmins();
}, 20000);

// The Super Admin logs an admin out (they are sent to the login page; they can log in again)
async function forceLogoutAdmin(adminId) {
  const a = allAdmins.find(x => x.admin_id === adminId);
  const name = a ? a.full_name : 'this admin';
  if (!(await askConfirm(`Log out ${name}? They are sent back to the login page right away. They can log in again.`, 'Log out'))) return;
  try {
    const res = await fetch(API.AUTH + '/admins/' + adminId + '/force-logout', { method: 'POST', headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not log the admin out.');
    await loadAdmins();
    showToast(`${name} was logged out.`);
  } catch (err) {
    showApiError(err.message);
  }
}

// Deactivate = cannot log in (and is logged out now). Activate = can log in again.
async function setAdminActive(adminId, active) {
  const a = allAdmins.find(x => x.admin_id === adminId);
  const name = a ? a.full_name : 'this admin';
  if (!active && !(await askConfirm(`Deactivate ${name}? They are logged out right away, and cannot log in until you activate the account again.`, 'Deactivate'))) return;
  try {
    const res = await fetch(API.AUTH + '/admins/' + adminId + '/active', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ active }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not change the account.');
    await loadAdmins();
    showToast(active ? `${name} can log in again.` : `${name} was deactivated.`);
  } catch (err) {
    showApiError(err.message);
  }
}

// ===========================================================
// MESSAGES: the chat between the shop and the customers
// ===========================================================

function chatTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// the little number in the menu: how many messages of customers are not read yet
async function refreshMessageBadge() {
  if (!hasAccess('messages')) return;
  try {
    const res = await fetch(API.ORDERS + '/orders/messages/unread-count', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) return;
    const n = Number(data.unread) || 0;
    const badge = document.getElementById('messagesBadge');
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('hidden', n === 0);
  } catch (err) { /* not important */ }
}
setInterval(() => { if (!document.hidden && getToken()) refreshMessageBadge(); }, 20000);

function renderChatList() {
  const box = document.getElementById('chatList');
  if (chatState.threads.length === 0) {
    box.innerHTML = '<p class="chat-note">No messages yet. When a customer writes to the shop, the conversation shows up here.</p>';
    return;
  }
  box.innerHTML = chatState.threads.map(t => `
    <button type="button" class="chat-item ${t.thread_id === chatState.activeId ? 'active' : ''}" data-thread-id="${t.thread_id}">
      ${avatarPicture(t.profile_photo, t.customer_name)}
      <div class="chat-item-text">
        <div class="chat-item-top"><b>${orderEsc(t.customer_name)}</b><span class="chat-item-time">${orderEsc(chatTime(t.last_message_at))}</span></div>
        <div class="chat-item-preview ${t.admin_unread > 0 ? 'unread' : ''}">${orderEsc(t.last_preview || '')}</div>
      </div>
      ${t.admin_unread > 0 ? `<span class="chat-unread">${t.admin_unread > 99 ? '99+' : t.admin_unread}</span>` : ''}
    </button>`).join('');
}

async function loadChatList(quiet) {
  const box = document.getElementById('chatList');
  try {
    const res = await fetch(API.ORDERS + '/orders/messages', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load the messages.');
    chatState.threads = data;
    renderChatList();
    // something new in the conversation that is open: it is opened again, quietly
    const open = data.find(t => t.thread_id === chatState.activeId);
    if (open && (open.admin_unread > 0 || String(open.last_message_at) !== chatState.lastKey)) openThread(open.thread_id, true);
  } catch (err) {
    if (!quiet) box.innerHTML = `<p class="chat-note">${orderEsc(err.message)}</p>`;
  }
}

function openMessagesPage() {
  chatState.activeId = null;
  chatState.activeUserId = null;
  document.getElementById('chatBox').classList.add('hidden');
  document.getElementById('chatEmpty').classList.remove('hidden');
  document.getElementById('chatList').innerHTML = '<p class="chat-note">Loading...</p>';
  loadChatList(false);
  refreshMessageBadge();
}

async function openThread(threadId, quiet) {
  try {
    const res = await fetch(API.ORDERS + '/orders/messages/' + threadId, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not open the conversation.');
    const list = document.getElementById('chatMessages');
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    chatState.activeId = threadId;
    chatState.activeUserId = data.user_id;
    chatState.lastKey = data.messages.length ? String(data.messages[data.messages.length - 1].created_at) : '';
    document.getElementById('chatEmpty').classList.add('hidden');
    document.getElementById('chatBox').classList.remove('hidden');
    document.getElementById('chatHeadInfo').innerHTML = `${avatarPicture(data.profile_photo, data.customer_name)}<div><b>${orderEsc(data.customer_name)}</b><div class="muted-small">${orderEsc(data.email || '')}</div></div>`;
    document.getElementById('chatCustomerBtn').classList.toggle('hidden', !data.user_id);
    let lastDay = '';
    list.innerHTML = data.messages.map(m => {
      const day = new Date(m.created_at).toDateString();
      const separator = day !== lastDay ? `<div class="chat-day">${orderEsc(day === new Date().toDateString() ? 'Today' : new Date(m.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}</div>` : '';
      lastDay = day;
      return `${separator}<div class="chat-bubble ${m.sender === 'admin' ? 'admin' : 'customer'}"><div class="chat-text">${orderEsc(m.body)}</div><div class="chat-meta">${m.sender === 'admin' && m.admin_name ? orderEsc(m.admin_name) + ' · ' : ''}${orderEsc(new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</div></div>`;
    }).join('') || '<p class="chat-note">No messages yet.</p>';
    if (!quiet || atBottom) list.scrollTop = list.scrollHeight;
    const thread = chatState.threads.find(t => t.thread_id === threadId);
    if (thread) thread.admin_unread = 0; // opening it marked the messages as read
    renderChatList();
    refreshMessageBadge();
  } catch (err) {
    if (!quiet) showApiError(err.message);
  }
}

document.getElementById('chatList').addEventListener('click', (e) => {
  const item = e.target.closest('[data-thread-id]');
  if (item) openThread(Number(item.dataset.threadId), false);
});
document.getElementById('messagesRefresh').addEventListener('click', () => loadChatList(false));
document.getElementById('chatCustomerBtn').addEventListener('click', () => { if (chatState.activeUserId) openCustomerDetails(chatState.activeUserId); });
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('chatForm').requestSubmit(); } // Enter sends, Shift+Enter is a new line
});
document.getElementById('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const body = input.value.trim();
  if (!body || !chatState.activeId || chatState.sending) return;
  chatState.sending = true;
  document.getElementById('chatSend').disabled = true;
  try {
    const res = await fetch(API.ORDERS + '/orders/messages/' + chatState.activeId, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not send the message.');
    input.value = ''; // only a message that was sent is removed from the box
    await openThread(chatState.activeId, false);
    loadChatList(true);
  } catch (err) {
    showApiError(err.message);
  } finally {
    chatState.sending = false;
    document.getElementById('chatSend').disabled = false;
  }
});
// every 10 seconds the list (and the open conversation, if it has something new) is refreshed
setInterval(() => { if (!document.hidden && document.querySelector('#page-messages.active')) loadChatList(true); }, 10000);

// ===========================================================
// ACTIVITY (Super Admin only): who did what, newest first
// ===========================================================
const ACTIVITY_LABELS = { product: 'Product', stock: 'Stock', category: 'Category', order: 'Order', customer: 'Customer', review: 'Review', admin: 'Admin account', profile: 'Own profile' };
function activityKind(action) {
  if (action === 'admin.login') return ['Login', 'login'];
  if (action === 'admin.logout') return ['Logout', 'login'];
  const group = String(action).split('.')[0];
  return [ACTIVITY_LABELS[group] || group, group];
}

async function loadActivity(reset) {
  const body = document.getElementById('activityBody');
  const more = document.getElementById('activityMore');
  if (reset) { activityState.before = null; activityState.loaded = 0; body.innerHTML = '<tr><td colspan="4">Loading...</td></tr>'; more.classList.add('hidden'); }
  try {
    // the choice of admins is filled from the list of admins (once)
    const select = document.getElementById('activityAdmin');
    if (select.options.length <= 1) {
      const listRes = await fetch(API.AUTH + '/admins', { headers: authHeaders() });
      const admins = await listRes.json();
      if (listRes.ok && Array.isArray(admins)) {
        allAdmins = admins;
        admins.forEach(a => select.add(new Option(a.full_name + ' (@' + a.username + ')', String(a.admin_id))));
      }
    }
    const params = new URLSearchParams({ limit: '50' });
    const f = { admin_id: select.value, type: document.getElementById('activityType').value, from: document.getElementById('activityFrom').value, to: document.getElementById('activityTo').value };
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
    if (activityState.before) params.set('before', activityState.before);
    const res = await fetch(API.AUTH + '/admin-activity?' + params.toString(), { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load the activity.');
    if (data.notReady) { body.innerHTML = '<tr><td colspan="4">The activity log is not ready yet. Run <b>migration_admin_activity.sql</b> in MySQL Workbench first.</td></tr>'; return; }

    const rows = data.items.map(item => {
      const [label, kind] = activityKind(item.action);
      const when = new Date(item.created_at);
      return `<tr>
        <td><div>${orderEsc(when.toLocaleString())}</div><div class="muted-small">${orderEsc(timeAgo(item.created_at))}</div></td>
        <td><div class="inv-product">${avatarPicture(null, item.admin_name)}<b>${orderEsc(item.admin_name)}</b></div></td>
        <td><span class="badge badge-plain activity-${orderEsc(kind)}">${orderEsc(label)}</span></td>
        <td>${orderEsc(item.description)}</td>
      </tr>`;
    }).join('');
    if (reset) body.innerHTML = '';
    if (data.items.length) {
      body.insertAdjacentHTML('beforeend', rows);
      activityState.before = data.items[data.items.length - 1].activity_id;
      activityState.loaded += data.items.length;
    } else if (reset) {
      body.innerHTML = '<tr><td colspan="4">No activity found.</td></tr>';
    }
    more.classList.toggle('hidden', !data.hasMore);
  } catch (err) {
    if (reset) body.innerHTML = `<tr><td colspan="4">${orderEsc(err.message)}</td></tr>`;
    else showToast(err.message, true);
  }
}

function getCurrentAdmin() {
  return JSON.parse(sessionStorage.getItem('fitora_admin') || 'null');
}

// The Super Admin changes the details of an admin (name, username, email, role, and what they can open)
function openEditAdmin(adminId) {
  const a = allAdmins.find(x => x.admin_id === adminId);
  if (!a) return;
  const me = getCurrentAdmin();
  const isSelf = !!me && me.id === adminId;
  const current = (a.permissions || '').split(',').filter(Boolean);
  document.querySelector('#modalOverlay .modal').classList.remove('modal-wide');
  modalTitle.textContent = 'Edit admin';
  modalForm.innerHTML = `
    <label>Full name</label>
    <input type="text" id="f_admin_name" value="${orderEsc(a.full_name)}" maxlength="100" required>

    <label>Username</label>
    <input type="text" id="f_admin_username" value="${orderEsc(a.username)}" maxlength="30" required>

    <label>Email</label>
    <input type="email" id="f_admin_email" value="${orderEsc(a.email || '')}">
    <small class="muted-small">If the email is changed, it has to be verified again.</small>

    <label>Role</label>
    <select id="f_admin_role" ${isSelf ? 'disabled' : ''}>
      <option value="staff" ${a.role === 'staff' ? 'selected' : ''}>Staff (limited access)</option>
      <option value="super_admin" ${a.role === 'super_admin' ? 'selected' : ''}>Super Admin (full access)</option>
    </select>
    ${isSelf ? '<small class="muted-small">You cannot change your own role.</small>' : ''}

    <div id="permissionsGroup" class="${a.role === 'super_admin' ? 'hidden' : ''}">
      <label>Sections this staff member can open</label>
      ${ADMIN_PERMISSION_OPTIONS.map(([key, label]) => `
        <label style="display:flex; align-items:center; gap:8px; font-weight:normal; margin-top:6px;">
          <input type="checkbox" class="perm-checkbox" value="${key}" ${current.includes(key) ? 'checked' : ''}> ${label}
        </label>`).join('')}
    </div>
    <p class="muted-small" style="margin-top:12px;">The changes work right away.</p>

    <div class="modal-actions">
      <button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button>
      <button type="submit" class="primary-btn">Save changes</button>
    </div>`;

  const roleSelect = document.getElementById('f_admin_role');
  roleSelect.addEventListener('change', () => document.getElementById('permissionsGroup').classList.toggle('hidden', roleSelect.value === 'super_admin'));

  modalForm.onsubmit = async (e) => {
    e.preventDefault();
    const role = isSelf ? a.role : roleSelect.value;
    const payload = {
      full_name: document.getElementById('f_admin_name').value.trim(),
      username: document.getElementById('f_admin_username').value.trim(),
      email: document.getElementById('f_admin_email').value.trim(),
      role,
      permissions: role === 'staff' ? Array.from(document.querySelectorAll('.perm-checkbox:checked')).map(cb => cb.value) : [],
    };
    try {
      const res = await fetch(API.AUTH + '/admins/' + adminId, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the changes.');
      closeModal();
      await loadAdmins(); // the table is updated first, then the message
      showToast('Admin account updated.');
      if (isSelf) refreshAdminSession();
    } catch (err) {
      showApiError(err.message);
    }
  };
  modalOverlay.classList.remove('hidden');
}

// The Super Admin sets a new password for another admin (staff cannot change their own)
function openResetPassword(adminId) {
  const a = allAdmins.find(x => x.admin_id === adminId);
  if (!a) return;
  document.querySelector('#modalOverlay .modal').classList.remove('modal-wide');
  modalTitle.textContent = 'Reset password - ' + a.full_name;
  modalForm.innerHTML = `
    <p class="muted-small">Choose a new password for <b>${orderEsc(a.full_name)}</b> (@${orderEsc(a.username)}). Then tell them the new password.</p>
    <label>New password</label>
    <input type="password" id="f_new_password" autocomplete="new-password" required>
    <label>Type it again</label>
    <input type="password" id="f_new_password2" autocomplete="new-password" required>
    <small class="muted-small">At least 8 characters, with uppercase and lowercase letters, a number, and a special character (for example !@#$%).</small>
    <div class="modal-actions">
      <button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button>
      <button type="submit" class="primary-btn">Save new password</button>
    </div>`;
  modalForm.onsubmit = async (e) => {
    e.preventDefault();
    const password = document.getElementById('f_new_password').value;
    if (password !== document.getElementById('f_new_password2').value) { showApiError('The two passwords are not the same.', 'Check the password'); return; }
    try {
      const res = await fetch(API.AUTH + '/admins/' + adminId + '/password', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ new_password: password }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the password.');
      closeModal();
      openPopup({ type: 'success', title: 'Password changed', message: data.message, buttons: [{ text: 'OK', value: true }] });
    } catch (err) {
      showApiError(err.message);
    }
  };
  modalOverlay.classList.remove('hidden');
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
    <small class="muted-small">At least 8 characters, with uppercase and lowercase letters, a number, and a special character (for example !@#$%).</small>

    <label>Role</label>
    <select id="f_admin_role">
      <option value="staff">Staff (limited access)</option>
      <option value="super_admin">Super Admin (full access)</option>
    </select>

    <div id="permissionsGroup">
      <label>Modules this staff member can open (Staff only)</label>
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
      alert(data.error || 'Could not add the admin.');
      return;
    }

    closeModal();
    await loadAdmins();
    showToast('Admin account added.');
  };

  modalOverlay.classList.remove('hidden');
});

async function deleteAdmin(adminId) {
  const a = allAdmins.find(x => x.admin_id === adminId);
  const name = a ? a.full_name : 'this admin';
  if (!(await askConfirm(`Delete the admin account of ${name}? They will be logged out right away and can no longer log in. This cannot be undone.`))) return;
  try {
    const res = await fetch(API.AUTH + '/admins/' + adminId, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not delete the account.');
    await loadAdmins();
    showToast('Admin account deleted.');
  } catch (err) {
    showApiError(err.message);
  }
}

// ===========================================================
// MY PROFILE (the admin who is logged in)
// ===========================================================

async function loadProfile() {
  const box = document.getElementById('profileContent');
  box.innerHTML = '<p class="detail-loading">Loading...</p>';
  profileEditing = false;
  try {
    const res = await fetch(API.AUTH + '/admins/me', { headers: authHeaders() });
    const me = await res.json();
    if (!res.ok) throw new Error(me.error || 'Could not load your profile.');
    profileState = me;
    saveAdminSession(me);
    renderAdminChip();
    renderProfile(me);
  } catch (err) {
    box.innerHTML = `<div class="detail-error">${orderEsc(err.message)}</div>`;
  }
}

// Saves the name, the email, and / or the photo directly. Whatever is not sent stays as it is.
// (A Super Admin who has an email confirms a new name or email with a code instead: see requestChange.)
async function saveProfile(me, changes) {
  const body = { full_name: me.fullName, email: me.email || '', ...changes };
  const res = await fetch(API.AUTH + '/admins/me', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save your profile.');
  profileState = data.admin;
  saveAdminSession(data.admin);
  renderAdminChip();
  renderProfile(data.admin);
  return data;
}

// Step 1 of a change that needs the email code: the server checks it and emails a 6-digit code
async function requestChange(payload) {
  const res = await fetch(API.AUTH + '/admins/me/changes/request', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not start the change.');
  return data;
}

// Step 2: the window where the code is typed. Only then are the changes saved.
function openConfirmWindow(payload, info) {
  document.querySelector('#modalOverlay .modal').classList.remove('modal-wide');
  modalTitle.textContent = 'Confirm your changes';
  const lines = [];
  if (info.changes.full_name) lines.push(['Name', info.changes.full_name]);
  if (info.changes.username) lines.push(['Username', '@' + info.changes.username]);
  if (info.changes.email) lines.push(['Email', info.changes.email]);
  if (info.changes.password) lines.push(['Password', 'will be changed']);

  modalForm.innerHTML = `
    <p class="muted-small">For your security, we sent a 6-digit code to <b>${orderEsc(info.email)}</b>. Type it here to save these changes:</p>
    <ul class="change-list">${lines.map(([label, value]) => `<li><span>${orderEsc(label)}</span><b>${orderEsc(value)}</b></li>`).join('')}</ul>
    <label>6-digit code</label>
    <input type="text" id="c_code" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code" required>
    <small class="muted-small">The code works for 10 minutes. Nothing is saved until you confirm. <button type="button" class="link-btn" id="c_resend">Send a new code</button></small>
    <div class="modal-actions">
      <button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button>
      <button type="submit" class="primary-btn">Confirm and save</button>
    </div>`;

  document.getElementById('c_resend').addEventListener('click', async () => {
    try {
      await requestChange(payload);
      showToast('A new code was sent to your email.');
    } catch (err) {
      showApiError(err.message);
    }
  });

  modalForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(API.AUTH + '/admins/me/changes/confirm', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ code: document.getElementById('c_code').value.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not confirm the changes.');
      closeModal();
      profileEditing = false;
      profileState = data.admin;
      saveAdminSession(data.admin);
      renderAdminChip();
      renderProfile(data.admin);
      showToast(data.emailChanged ? 'Your changes were saved. Please verify your new email.' : 'Your changes were saved.');
    } catch (err) {
      showApiError(err.message); // the window stays open so the code can be typed again
    }
  };
  modalOverlay.classList.remove('hidden');
}

function renderProfile(me) {
  const box = document.getElementById('profileContent');
  const isSuper = me.role === 'super_admin';
  const hasEmail = !!me.email;
  const verified = hasEmail && !!me.emailVerified;
  // A Super Admin with a VERIFIED email confirms changes with a code sent to it.
  // If the email is not verified (or missing, or a wrong address), no code could arrive, so the name and the
  // email can be fixed directly here; the new email is then verified, and after that the codes protect the account.
  const needsCode = isSuper && verified;
  const fixing = isSuper && !verified;

  const photo = me.profilePhoto
    ? `<img class="profile-photo" alt="" src="${orderEsc(me.profilePhoto.includes('/image/upload/') ? me.profilePhoto.replace('/image/upload/', '/image/upload/c_fill,w_240,h_240,q_auto/') : me.profilePhoto)}">`
    : `<span class="profile-photo profile-initials">${orderEsc(initialsOf(me.fullName))}</span>`;
  const emailBadge = hasEmail
    ? (verified ? '<span class="badge badge-plain badge-active">Email verified</span>' : '<span class="badge badge-plain badge-pending">Email not verified</span>')
    : '<span class="badge badge-plain">No email yet</span>';

  // ----- a message on top when the Super Admin's email is not verified yet -----
  const alertBox = !fixing ? '' : `
    <div class="profile-alert">
      <span class="profile-alert-icon">!</span>
      <div class="profile-alert-text">
        <b>${hasEmail ? 'Verify your email to secure your account' : 'Add your email to secure your account'}</b>
        <p>${hasEmail
          ? `We cannot send you confirmation codes until <b>${orderEsc(me.email)}</b> is verified. If this address is not real or not yours, press <b>Change email</b> first.`
          : 'Press Add email, type your real email address, and save it. Then verify it with the code we send you.'}</p>
      </div>
      <div class="profile-alert-actions">
        ${hasEmail ? '<button type="button" class="primary-btn" id="alertVerifyBtn">Send verification code</button>' : ''}
        <button type="button" class="secondary-btn" id="alertEditBtn">${hasEmail ? 'Change email' : 'Add email'}</button>
      </div>
    </div>`;

  // ----- the personal details: shown, or (after Edit) a form -----
  const detailsBody = profileEditing
    ? `<form id="profileForm">
         <label>Full name</label>
         <input type="text" id="p_name" value="${orderEsc(me.fullName)}" maxlength="100" required>
         <label>Email</label>
         <input type="email" id="p_email" value="${orderEsc(me.email || '')}">
         <small class="muted-small">${needsCode ? 'Your changes are confirmed with a code sent to your current email.' : fixing ? 'Type your real email address. You will verify it next, with a code we send to it.' : 'If you change your email, you will have to verify it again.'}</small>
         <label>Username</label>
         <input type="text" id="p_username" value="${orderEsc(me.username)}" maxlength="30" ${needsCode ? '' : 'disabled'}>
         <small class="muted-small">${needsCode ? 'Letters, numbers, dots, dashes, or underscores (3-30).' : isSuper ? 'You can change your username after your email is verified.' : 'Only the Super Admin can change a username.'}</small>
         <div class="profile-actions">
           <button type="submit" class="primary-btn">Save changes</button>
           <button type="button" class="secondary-btn" id="cancelEditBtn">Cancel</button>
         </div>
       </form>`
    : `<div class="info-list">
         <div class="info-row"><span>Full name</span><b>${orderEsc(me.fullName)}</b></div>
         <div class="info-row"><span>Email</span><b>${orderEsc(me.email || 'Not set')}</b></div>
         <div class="info-row"><span>Username</span><b>@${orderEsc(me.username)}</b></div>
       </div>
       ${needsCode ? '<p class="card-note">For your security, changes to your name, username, or email are confirmed with a code sent to your email.</p>' : ''}`;

  // ----- email verification -----
  const emailBody = !hasEmail
    ? `<p class="muted-small">You have no email yet. Add one so you can confirm changes and keep your account safe.</p>
       <div class="profile-actions"><button type="button" class="secondary-btn" id="addEmailBtn">Add email</button></div>`
    : verified
      ? `<div class="detail-note detail-note-ok">Your email <b>${orderEsc(me.email)}</b> is verified.</div>`
      : `<p class="muted-small">We will send a 6-digit code to <b>${orderEsc(me.email)}</b>. Is it the wrong address? Press Change email.</p>
         <div class="profile-actions">
           <button type="button" class="primary-btn" id="sendCodeBtn">Send verification code</button>
           <button type="button" class="secondary-btn" id="changeEmailBtn">Change email</button>
         </div>
         <div id="codeBox" class="hidden">
           <label>6-digit code</label>
           <input type="text" id="p_code" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code">
           <div class="profile-actions"><button type="button" class="primary-btn" id="verifyCodeBtn">Verify email</button></div>
         </div>`;

  // ----- password -----
  const passwordDisabled = needsCode ? '' : 'disabled';
  const passwordBody = isSuper
    ? `<form id="passwordForm">
         <label>Current password</label>
         <input type="password" id="p_current" autocomplete="current-password" ${passwordDisabled} required>
         <label>New password</label>
         <input type="password" id="p_new" autocomplete="new-password" ${passwordDisabled} required>
         <label>Type the new password again</label>
         <input type="password" id="p_new2" autocomplete="new-password" ${passwordDisabled} required>
         <small class="muted-small">At least 8 characters, with uppercase and lowercase letters, a number, and a special character (for example !@#$%).</small>
         <p class="card-note">${needsCode ? 'The change is confirmed with a code sent to your email.' : 'Verify your email first. Password changes are confirmed with a code sent to it.'}</p>
         <div class="profile-actions"><button type="submit" class="primary-btn" ${passwordDisabled}>Change password</button></div>
       </form>`
    : `<div class="lock-note"><span class="lock-icon">🔒</span><div><b>Only the Super Admin can change passwords.</b><div class="muted-small" style="color:inherit; opacity:0.85;">If you forgot your password or want a new one, please ask the Super Admin to reset it for you.</div></div></div>`;

  const permissions = (me.permissions || []);
  const accessBody = isSuper
    ? '<div class="detail-note detail-note-ok">You have full access to every section.</div>'
    : `<p class="muted-small" style="margin-bottom:10px;">The Dashboard and My profile are always open to you.</p>${permissions.map(p => `<span class="pill">${orderEsc(PERMISSION_LABELS[p] || p)}</span>`).join('') || '<span class="muted-small">No other sections yet. Ask the Super Admin.</span>'}`;

  box.innerHTML = `
    <div class="profile-grid">
      <div class="profile-banner">
        <div class="profile-photo-wrap">${photo}</div>
        <div class="profile-banner-info">
          <div class="profile-name">${orderEsc(me.fullName)}</div>
          <div class="profile-sub">@${orderEsc(me.username)} · Member since ${orderEsc(new Date(me.createdAt).toLocaleDateString())}</div>
          <div class="profile-badges"><span class="badge ${isSuper ? 'badge-active' : ''}">${isSuper ? 'Super Admin' : 'Staff'}</span>${emailBadge}</div>
        </div>
        <div class="profile-banner-actions">
          <button type="button" class="primary-btn" id="profilePhotoBtn">${me.profilePhoto ? 'Change photo' : 'Add photo'}</button>
          ${me.profilePhoto ? '<button type="button" class="secondary-btn" id="profilePhotoRemove">Remove photo</button>' : ''}
          <input type="file" id="profilePhotoInput" accept="image/*" class="hidden">
          <p class="profile-photo-status" id="profilePhotoStatus"></p>
        </div>
      </div>

      ${alertBox}

      <div class="profile-main">
        <div class="card">
          <div class="card-head">
            <h3>Personal details</h3>
            ${profileEditing ? '' : '<button type="button" class="secondary-btn" id="editDetailsBtn">Edit</button>'}
          </div>
          ${detailsBody}
        </div>
        <div class="card"><div class="card-head"><h3>Password</h3></div>${passwordBody}</div>
      </div>

      <div class="profile-side">
        <div class="card" id="emailCard"><div class="card-head"><h3>Email verification</h3></div>${emailBody}</div>
        <div class="card"><div class="card-head"><h3>What I can open</h3></div>${accessBody}</div>
      </div>
    </div>`;

  // ----- the photo (no code needed) -----
  const input = document.getElementById('profilePhotoInput');
  const status = document.getElementById('profilePhotoStatus');
  document.getElementById('profilePhotoBtn').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { status.textContent = 'Please choose a picture (an image file).'; return; }
    if (file.size > 5 * 1024 * 1024) { status.textContent = 'The picture is too big. Please choose one under 5 MB.'; return; }
    status.textContent = 'Uploading...';
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      const upload = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: formData });
      const uploaded = await upload.json();
      if (!uploaded.secure_url) throw new Error((uploaded.error && uploaded.error.message) || 'The picture could not be uploaded.');
      profileEditing = false;
      await saveProfile(me, { profile_photo: uploaded.secure_url });
      showToast('Your photo was saved.');
    } catch (err) {
      status.textContent = err.message;
    }
  });
  const remove = document.getElementById('profilePhotoRemove');
  if (remove) remove.addEventListener('click', async () => {
    try { profileEditing = false; await saveProfile(me, { profile_photo: '' }); showToast('Your photo was removed.'); } catch (err) { showApiError(err.message); }
  });

  // ----- the details: Edit, Cancel, Save -----
  const startEdit = () => { profileEditing = true; renderProfile(me); };
  ['editDetailsBtn', 'alertEditBtn', 'changeEmailBtn', 'addEmailBtn'].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.addEventListener('click', startEdit);
  });
  const cancelBtn = document.getElementById('cancelEditBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { profileEditing = false; renderProfile(me); });
  const profileForm = document.getElementById('profileForm');
  if (profileForm) profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('p_name').value.trim();
    const email = document.getElementById('p_email').value.trim();
    try {
      if (needsCode) {
        // only what really changed is sent, and a code from the email is needed to save it
        const details = {};
        if (name !== me.fullName) details.full_name = name;
        if (email.toLowerCase() !== (me.email || '').toLowerCase()) details.email = email;
        const username = document.getElementById('p_username').value.trim();
        if (username !== me.username) details.username = username;
        if (Object.keys(details).length === 0) { showToast('Nothing was changed.'); profileEditing = false; renderProfile(me); return; }
        const payload = { details };
        openConfirmWindow(payload, await requestChange(payload));
      } else {
        profileEditing = false;
        const data = await saveProfile(me, { full_name: name, email });
        showToast(data.emailChanged ? 'Saved. Now verify your new email.' : 'Your profile was saved.');
      }
    } catch (err) {
      showApiError(err.message);
    }
  });

  // ----- the email code (to verify the email) -----
  const sendBtn = document.getElementById('sendCodeBtn');
  if (sendBtn) {
    const sendCode = async () => {
      sendBtn.disabled = true;
      try {
        const res = await fetch(API.AUTH + '/admins/me/send-code', { method: 'POST', headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not send the code.');
        document.getElementById('codeBox').classList.remove('hidden');
        document.getElementById('p_code').focus();
        showToast(data.message || 'We sent you a code. Check your inbox (and the spam folder).');
      } catch (err) {
        showApiError(err.message);
      }
      sendBtn.disabled = false;
    };
    sendBtn.addEventListener('click', sendCode);
    const alertVerify = document.getElementById('alertVerifyBtn');
    if (alertVerify) alertVerify.addEventListener('click', () => { document.getElementById('emailCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); sendCode(); });
    document.getElementById('verifyCodeBtn').addEventListener('click', async () => {
      try {
        const res = await fetch(API.AUTH + '/admins/me/verify-code', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ code: document.getElementById('p_code').value.trim() }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not verify the code.');
        showToast('Your email is verified.');
        loadProfile();
      } catch (err) {
        showApiError(err.message);
      }
    });
  }

  // ----- the password (Super Admin only, confirmed with a code from the email) -----
  const passwordForm = document.getElementById('passwordForm');
  if (passwordForm) {
    passwordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const next = document.getElementById('p_new').value;
      if (next !== document.getElementById('p_new2').value) { showApiError('The two new passwords are not the same.', 'Check the password'); return; }
      try {
        const payload = { password: { current_password: document.getElementById('p_current').value, new_password: next } };
        openConfirmWindow(payload, await requestChange(payload));
      } catch (err) {
        showApiError(err.message);
      }
    });
  }
}