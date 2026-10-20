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
      : '<li>No low-stock products.</li>';

    const recentList = document.getElementById('recentOrdersList');
    recentList.innerHTML = orders.slice(0, 5).map(o =>
      `<li><span><b>${orderEsc(o.order_code || 'Order #' + o.order_id)}</b> · ${orderEsc(o.customer_name || 'N/A')}${o.items_summary ? `<span class="muted-small" style="display:block">${orderEsc(o.items_summary)}</span>` : ''}</span><span>₱${Number(o.total_amount).toLocaleString()}</span></li>`
    ).join('') || '<li>No orders yet.</li>';

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
      `).join('') || '<tr><td colspan="3">No categories yet.</td></tr>';
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
      <td>${p.image
        ? `<img src="${p.image}" class="thumb" alt="${p.product_name}" onerror="this.replaceWith(Object.assign(document.createElement('div'), {className:'thumb-placeholder', textContent:'📦'}))">`
        : `<div class="thumb-placeholder">📦</div>`}</td>
      <td>${p.product_name}</td>
      <td>${p.category_name || '-'}</td>
      <td>₱${Number(p.price).toLocaleString()}</td>
      <td>${p.stock}</td>
      <td><span class="badge badge-${p.status}">${p.status}</span></td>
      <td>
        <button class="icon-btn" onclick="openImagesModal(${p.product_id})">Photos</button>
        <button class="icon-btn" onclick="openProductModal(${p.product_id})">Edit</button>
        <button class="icon-btn danger" onclick="deleteProduct(${p.product_id})">Delete</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7">No matching products.</td></tr>';
}

document.getElementById('productSearch').addEventListener('input', renderProductsTable);
document.getElementById('productCategoryFilter').addEventListener('change', renderProductsTable);
document.getElementById('productSort').addEventListener('change', renderProductsTable);

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
  let product = { product_name: '', category_id: '', price: '', stock: 0, weight_grams: 300, status: 'active', description: '', image: '' };

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
      <option value="">-- No category --</option>
      ${categoryOptions}
    </select>

    <label>Description</label>
    <textarea id="f_description" rows="2">${product.description || ''}</textarea>

    <label>Image URL</label>
    <input type="text" id="f_image" placeholder="https://..." value="${product.image || ''}">

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
      image: document.getElementById('f_image').value.trim(),
      price: parseFloat(document.getElementById('f_price').value),
      stock: parseInt(document.getElementById('f_stock').value),
      weight_grams: parseInt(document.getElementById('f_weight').value),
      status: document.getElementById('f_status').value,
    };

    const url = productId ? API.PRODUCTS + '/products/' + productId : API.PRODUCTS + '/products';
    const method = productId ? 'PUT' : 'POST';

    await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
    closeModal();
    loadProducts();
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
let allProductsForInventory = [];

async function loadInventory() {
  const tbody = document.getElementById('inventoryTableBody');
  try {
    const res = await fetch(API.PRODUCTS + '/products');
    allProductsForInventory = await res.json();
    renderInventoryTable();
    loadStockLogs();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4">Cannot reach the product service. Please try again.</td></tr>';
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
  `).join('') || '<tr><td colspan="4">No products yet.</td></tr>';
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
    }).join('') || '<li>No stock changes yet.</li>';
  } catch (err) {
    list.innerHTML = '<li>Could not load the stock history.</li>';
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
      <option value="Restock">Restock (add)</option>
      <option value="Damaged">Damaged goods (remove)</option>
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
      alert(data.error || 'Could not adjust the stock.');
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

async function loadOrders() {
  const tbody = document.getElementById('ordersTableBody');
  try {
    const res = await fetch(API.ORDERS + '/orders', { headers: authHeaders() });
    const orders = await res.json();
    if (!res.ok) throw new Error(orders.error || 'Could not load the orders.');
    ordersCache = Object.fromEntries(orders.map(o => [o.order_id, o]));

    tbody.innerHTML = orders.map(o => {
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
    }).join('') || '<tr><td colspan="5">No orders yet.</td></tr>';
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5">Cannot reach the order service. Please try again.</td></tr>';
  }
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
    ).join('') || '<li>No sales data yet.</li>';

    const catList = document.getElementById('categoryRevenueList');
    catList.innerHTML = byCategory.map(c =>
      `<li><span>${c.category_name}</span><span>₱${Number(c.revenue).toLocaleString()}</span></li>`
    ).join('') || '<li>No categories yet.</li>';

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

  tbody.innerHTML = list.map(c => `
    <tr>
      <td><button type="button" class="link-btn" onclick="openCustomerDetails(${c.user_id})">${orderEsc(c.full_name)}</button></td>
      <td>${orderEsc(c.email)}</td>
      <td>${c.phone || '-'}</td>
      <td>${c.order_count}</td>
      <td><span class="badge badge-${c.is_active ? 'active' : 'inactive'}">${c.is_active ? 'active' : 'inactive'}</span></td>
      <td>
        <button class="icon-btn" onclick="openCustomerDetails(${c.user_id})">View</button>
        <button class="icon-btn ${c.is_active ? 'danger' : ''}" onclick="toggleCustomerStatus(${c.user_id}, ${c.is_active ? 0 : 1})">
          ${c.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6">No registered customers yet.</td></tr>';
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
// ===========================================================
// NOTIFICATIONS (the bell)
// They are saved on the server and they stay, even after the order was processed.
// A notification glows until THIS admin opens it. Pressing one goes straight to the order / product.
// ===========================================================
let notificationItems = [];
const NOTIF_PAGES = { new_order: 'orders', payment: 'orders', cancel_request: 'orders', order_cancelled: 'orders', refund: 'orders', low_stock: 'inventory', new_review: 'reviews' };
const NOTIF_TABLES = { orders: 'ordersTableBody', inventory: 'inventoryTableBody', reviews: 'reviewsTableBody' };

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
  history.replaceState(null, '', '#' + page);
  navigateTo(page);
  highlightRow(NOTIF_TABLES[page], item.ref_text);
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
          <div style="margin-top:8px;"><span class="badge badge-${c.isActive ? 'active' : 'inactive'}">${c.isActive ? 'active' : 'inactive'}</span></div>
        </div>
      </div>
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
      <div class="modal-actions"><button type="button" class="primary-btn" onclick="closeModal()">Close</button></div>`);

    if (back) document.getElementById('detailBack').addEventListener('click', back);
    modalForm.querySelectorAll('[data-order]').forEach(btn => btn.addEventListener('click', () => {
      openOrderDetails(Number(btn.dataset.order), () => openCustomerDetails(userId, back));
    }));
  } catch (err) {
    detailsError('Customer details', err.message);
  }
}

// ===========================================================
// REVIEWS MANAGEMENT
// ===========================================================
async function loadReviews() {
  const tbody = document.getElementById('reviewsTableBody');
  try {
    const res = await fetch(API.PRODUCTS + '/reviews', { headers: authHeaders() });
    const reviews = await res.json();

    tbody.innerHTML = reviews.map(r => {
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
      return `
      <tr>
        <td>${orderEsc(r.product_name)}</td>
        <td>${orderEsc(r.customer_name)}</td>
        <td>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td>
        <td>${orderEsc(r.comment || '-')}${media ? `<div>${media}</div>` : ''}</td>
        <td><span class="badge badge-${r.status === 'approved' ? 'active' : r.status === 'hidden' ? 'inactive' : 'pending'}">${r.status}</span></td>
        <td>
          ${r.status !== 'approved' ? `<button class="icon-btn" onclick="updateReviewStatus(${r.review_id}, 'approved')">Approve</button>` : ''}
          ${r.status !== 'hidden' ? `<button class="icon-btn" onclick="updateReviewStatus(${r.review_id}, 'hidden')">Hide</button>` : ''}
          <button class="icon-btn danger" onclick="deleteReview(${r.review_id})">Delete</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="6">No reviews yet.</td></tr>';

    // clicking a photo or the video opens the viewer
    tbody.onclick = (e) => {
      const link = e.target.closest('.review-media');
      if (link) {
        e.preventDefault();
        openMediaViewer(link.dataset.url, link.dataset.type);
      }
    };
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6">Cannot reach the product service. Please try again.</td></tr>';
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
  if (!(await askConfirm('Are you sure you want to delete this review?'))) return;
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
            ? '<span style="color:var(--text-muted); font-size:13px;">You</span>'
            : `<button class="icon-btn danger" onclick="deleteAdmin(${a.admin_id})">Delete</button>`}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="6">No admins yet.</td></tr>';
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4">Cannot reach the auth service. Please try again.</td></tr>';
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
    loadAdmins();
  };

  modalOverlay.classList.remove('hidden');
});

async function deleteAdmin(adminId) {
  if (!(await askConfirm('Are you sure you want to delete this admin account?'))) return;
  const res = await fetch(API.AUTH + '/admins/' + adminId, { method: 'DELETE', headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Could not delete.');
    return;
  }
  loadAdmins();
}