// =========================================================
// NORDICA NUTRITION - Admin Panel Logic (Full-Stack PG)
// Syncs with NordicaStore (Express REST APIs)
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
  // ---- Tab Switching Navigation ----
  const tabs = document.querySelectorAll('.nav-item[data-target]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.target;
      switchTab(target);
      // Close mobile sidebar if open
      document.getElementById('sidebar')?.classList.remove('open');
      const toggleBtn = document.getElementById('sidebarToggle');
      if (toggleBtn) toggleBtn.innerHTML = `<i class="fas fa-bars"></i>`;
    });
  });

  // Mobile Sidebar Toggle
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  sidebarToggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('open');
    const isOpen = sidebar?.classList.contains('open');
    sidebarToggle.innerHTML = isOpen ? `<i class="fas fa-times"></i>` : `<i class="fas fa-bars"></i>`;
  });

  document.getElementById('adminLogoutBtn')?.addEventListener('click', async () => {
    await NordicaStore.logout();
    window.location.href = '../login.html';
  });

  // Start with Overview Tab
  switchTab('overview');

  // Attach search and filter event listeners
  setupFilters();
});

// =========================================================
// STATE AND IMAGE HANDLING
// =========================================================
let currentEditingId = null;
let uploadedImageBase64 = null; // Stored as a URL string in the full-stack version
let activeDeleteTarget = null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const jsStringArg = value => escapeHtml(JSON.stringify(String(value ?? '')));
const parseArray = value => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Resolve image paths dynamically for Admin Panel
const getImgUrl = (path) => {
  if (!path) return '../assets/logo.png';
  if (path.startsWith('/uploads/')) return '..' + path; // Stored by multer as /uploads/..., resolve relative to admin/
  if (path.startsWith('data:image/')) return path; // Base64
  if (path.startsWith('http://') || path.startsWith('https://')) return path; // External Web URL
  if (path.startsWith('../')) return path; // Already points correctly
  return '../' + path; // Prepend admin relative parent folder
};

// Canvas Image Compression + server upload
window.previewUpload = (event, prefix) => {
  const file = event.target.files[0];
  if (!file) return;

  const preview = document.getElementById(`${prefix}-img-preview`);
  const container = document.getElementById(`${prefix}-preview-container`);
  const status = document.getElementById(`${prefix}-img-status`);

  if (status) status.textContent = "Compressing & uploading...";
  if (container) container.style.display = 'flex';

  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = (e) => {
    const img = new Image();
    img.src = e.target.result;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 400;
      const MAX_HEIGHT = 400;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Convert canvas to binary blob and upload
      canvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append('image', blob, file.name);

        try {
          const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
          });
          const data = await res.json();
          if (data.url) {
            uploadedImageBase64 = data.url; // Save the path returned by Node (e.g. /uploads/filename.jpg)
            preview.src = getImgUrl(data.url);
            if (status) status.textContent = "Uploaded successfully.";
          } else {
            throw new Error("Upload failed.");
          }
        } catch (err) {
          console.error("Image upload error:", err);
          if (status) status.textContent = "Upload failed.";
          showToast("Image upload failed.", "warning");
        }
      }, 'image/jpeg', 0.85);
    };
  };
};

window.previewUrl = (url, prefix) => {
  const preview = document.getElementById(`${prefix}-img-preview`);
  const container = document.getElementById(`${prefix}-preview-container`);
  const status = document.getElementById(`${prefix}-img-status`);

  if (!url) {
    // Only hide preview if empty URL, but don't clear uploadedImageBase64
    // This preserves existing images when editing products
    if (container && !uploadedImageBase64) {
      container.style.display = 'none';
    }
    return;
  }

  uploadedImageBase64 = url;
  preview.src = getImgUrl(url);
  if (container) container.style.display = 'flex';
  if (status) status.textContent = "Web Link Loaded";

  // Clear File Upload field
  const fileInput = document.getElementById(`${prefix}-img-file`);
  if (fileInput) fileInput.value = '';
};

// Toggle Switch UI helper
window.toggleSwitch = (id) => {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('on');
};

const getSwitchValue = (id) => {
  const el = document.getElementById(id);
  return el ? el.classList.contains('on') : true;
};

const setSwitchValue = (id, val) => {
  const el = document.getElementById(id);
  if (el) {
    el.classList.toggle('on', !!val);
  }
};

// =========================================================
// TAB SWITCH NAVIGATION
// =========================================================
async function switchTab(target) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.target === target);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${target}`);
  });

  const title = document.getElementById('pageTitle');
  const sub = document.getElementById('pageSub');
  const actions = document.getElementById('topbarActions');

  actions.innerHTML = '';

  if (target === 'overview') {
    title.textContent = 'Dashboard Overview';
    sub.textContent = 'Real-time sales summaries and quick admin operations.';
    await initOverviewData();
  } else if (target === 'products') {
    title.textContent = 'Products Inventory';
    sub.textContent = 'Add, modify, or archive dietary supplements.';
    actions.innerHTML = `<button class="topbar-btn topbar-btn-primary" onclick="openAddProductModal()"><i class="fas fa-plus"></i> Add Product</button>`;
    await populateCategoriesSelect();
    await renderProductsList();
  } else if (target === 'categories') {
    title.textContent = 'Product Categories';
    sub.textContent = 'Define categories and group your inventory.';
    actions.innerHTML = `<button class="topbar-btn topbar-btn-primary" onclick="openAddCategoryModal()"><i class="fas fa-plus"></i> Add Category</button>`;
    await renderCategoriesList();
  } else if (target === 'packs') {
    title.textContent = 'Goal Bundles & Packs';
    sub.textContent = 'Manage promotional stacks for increased order sizes.';
    actions.innerHTML = `<button class="topbar-btn topbar-btn-primary" onclick="openAddPackModal()"><i class="fas fa-plus"></i> Create Pack</button>`;
    await renderPacksList();
  } else if (target === 'users') {
    title.textContent = 'Customer Base';
    sub.textContent = 'Review user details, customer worth, and contact information.';
    actions.innerHTML = `<button class="topbar-btn topbar-btn-primary" onclick="openAddUserModal()"><i class="fas fa-user-plus"></i> Add Customer</button>`;
    await renderUsersList();
  } else if (target === 'deliveries') {
    title.textContent = 'Deliveries & Orders';
    sub.textContent = 'Track deliveries, modify courier statuses, and print invoices.';
    actions.innerHTML = `<button class="topbar-btn topbar-btn-primary" onclick="openAddDeliveryModal()"><i class="fas fa-truck"></i> Add Delivery</button>`;
    await renderDeliveriesList();
  }
  
  await updateSidebarBadges();
}

// =========================================================
// OVERVIEW STATISTICS
// =========================================================
async function initOverviewData() {
  const deliveries = await NordicaStore.get('deliveries');
  const products = await NordicaStore.get('products');
  const users = await NordicaStore.get('users');

  // Revenue = Sum of "delivered" deliveries
  const deliveredSales = deliveries
    .filter(d => d.status === 'delivered')
    .reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
  document.getElementById('stat-revenue').textContent = Math.round(deliveredSales).toLocaleString() + ' DT';

  // Delivery Counts
  document.getElementById('stat-deliveries').textContent = deliveries.length;
  const pendingCount = deliveries.filter(d => d.status === 'pending' || d.status === 'in-transit').length;
  document.getElementById('stat-deliveries-pending').textContent = pendingCount;

  // Products Counts
  document.getElementById('stat-products').textContent = products.length;
  const activeProducts = products.filter(p => p.active).length;
  document.getElementById('stat-products-active').textContent = activeProducts;

  // Customers Count
  document.getElementById('stat-users').textContent = users.length;

  // Render recent delivery updates
  const recentList = document.getElementById('recent-deliveries-list');
  if (recentList) {
    const recents = [...deliveries].slice(0, 4);
    if (recents.length === 0) {
      recentList.innerHTML = `<p style="font-size:0.85rem; color:var(--gray); text-align:center;">No recent deliveries.</p>`;
    } else {
      recentList.innerHTML = recents.map(d => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:var(--black-3); padding:10px 14px; border-radius:8px; border-left:3px solid var(--${d.status==='delivered'?'green':d.status==='pending'?'yellow':d.status==='in-transit'?'blue':'red'});">
          <div>
            <div style="font-size:0.85rem; font-weight:700; color:var(--white);">${escapeHtml(d.customer)}</div>
            <div style="font-size:0.72rem; color:var(--gray);">${escapeHtml(d.products)} • ${escapeHtml(d.wilaya)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:0.85rem; font-weight:700; color:var(--red);">${Math.round(d.amount).toLocaleString()} DT</div>
            <span class="badge-status ${escapeHtml(d.status)}" style="font-size:0.6rem; padding: 2px 6px;">${escapeHtml(d.status)}</span>
          </div>
        </div>
      `).join('');
    }
  }
}

async function updateSidebarBadges() {
  const products = await NordicaStore.get('products');
  const deliveries = await NordicaStore.get('deliveries');

  const prodBadge = document.getElementById('badge-products-count');
  if (prodBadge) prodBadge.textContent = products.length;

  const delBadge = document.getElementById('badge-deliveries-pending');
  if (delBadge) {
    const pend = deliveries.filter(d => d.status === 'pending').length;
    delBadge.textContent = pend;
    delBadge.style.display = pend > 0 ? 'inline-block' : 'none';
  }
}

// =========================================================
// SEARCH & FILTER SYSTEM
// =========================================================
function setupFilters() {
  document.getElementById('search-products')?.addEventListener('input', renderProductsList);
  document.getElementById('filter-products-cat')?.addEventListener('change', renderProductsList);
  document.getElementById('filter-products-stock')?.addEventListener('change', renderProductsList);
  document.getElementById('search-categories')?.addEventListener('input', renderCategoriesList);
  document.getElementById('search-packs')?.addEventListener('input', renderPacksList);
  document.getElementById('search-users')?.addEventListener('input', renderUsersList);
  document.getElementById('filter-users-status')?.addEventListener('change', renderUsersList);
  document.getElementById('search-deliveries')?.addEventListener('input', renderDeliveriesList);
  document.getElementById('filter-deliveries-status')?.addEventListener('change', renderDeliveriesList);
}

// =========================================================
// PRODUCTS CRUD OPERATIONS
// =========================================================
async function populateCategoriesSelect() {
  const cats = await NordicaStore.get('categories');
  const filterSelect = document.getElementById('filter-products-cat');
  const formSelect = document.getElementById('prod-cat');

  if (filterSelect) {
    filterSelect.innerHTML = `<option value="all">All Categories</option>` + 
      cats.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  }

  if (formSelect) {
    formSelect.innerHTML = cats.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  }
}

async function renderProductsList() {
  const products = await NordicaStore.get('products');
  const tbody = document.getElementById('table-products-body');
  const emptyView = document.getElementById('products-empty');

  if (!tbody) return;

  const searchQuery = document.getElementById('search-products').value.toLowerCase();
  const catFilter = document.getElementById('filter-products-cat').value;
  const stockFilter = document.getElementById('filter-products-stock').value;

  let filtered = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery) || 
                          (p.categoryName && p.categoryName.toLowerCase().includes(searchQuery));
    
    const matchesCat = (catFilter === 'all' || p.categoryId === catFilter);

    let matchesStock = true;
    if (stockFilter === 'instock') matchesStock = p.stock > 0;
    if (stockFilter === 'outofstock') matchesStock = p.stock <= 0;

    return matchesSearch && matchesCat && matchesStock;
  });

  document.getElementById('count-products').textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyView.style.display = 'block';
    return;
  }
  emptyView.style.display = 'none';

  tbody.innerHTML = filtered.map(p => `
    <tr>
      <td>
        <div class="td-product-cell">
          <img src="${escapeHtml(getImgUrl(p.image))}" alt="${escapeHtml(p.name)}" class="td-img" onerror="this.src='../assets/logo.png'">
          <div>
            <div class="td-product-name">${escapeHtml(p.name)}</div>
            <div class="td-product-sub">${escapeHtml(p.categoryName)}</div>
          </div>
        </div>
      </td>
      <td>${escapeHtml(p.categoryName)}</td>
      <td style="font-weight:700; color:var(--white);">${Math.round(p.price).toLocaleString()} DT</td>
      <td>
        <span style="font-weight:700; color:${p.stock > 10 ? 'var(--green)' : p.stock > 0 ? 'var(--orange)' : 'var(--red)'};">
          ${p.stock} units
        </span>
        <div style="margin-top: 8px;">
          <button class="action-icon-btn ${p.stock > 0 ? 'active' : 'inactive'}" 
            onclick="toggleProductStock(${jsStringArg(p.id)})" 
            title="${p.stock > 0 ? 'Mark as Out of Stock' : 'Mark as In Stock'}" 
            style="padding: 4px 10px; font-size: 0.7rem; font-weight: 600; width: auto; border-radius: 4px;">
            ${p.stock > 0 ? '✓ IN STOCK' : '✗ OUT OF STOCK'}
          </button>
        </div>
      </td>
      <td>
        ${p.badge ? `<span class="badge-status ${escapeHtml(p.badgeType || 'pending')}" style="font-size:0.65rem; padding: 2px 6px;">${escapeHtml(p.badge)}</span>` : '—'}
      </td>
      <td>
        <span class="badge-status ${p.active ? 'active' : 'inactive'}">
          ${p.active ? 'Active' : 'Archived'}
        </span>
      </td>
      <td>
        <div class="action-btns">
          <button class="action-icon-btn edit" onclick="openEditProductModal(${jsStringArg(p.id)})" title="Edit Product"><i class="fas fa-edit"></i></button>
          <button class="action-icon-btn delete" onclick="confirmDelete('products', ${jsStringArg(p.id)}, renderProductsList)" title="Delete Product"><i class="fas fa-trash-alt"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.openAddProductModal = () => {
  currentEditingId = null;
  uploadedImageBase64 = null;
  document.getElementById('product-modal-title').textContent = "Add New Product";
  document.getElementById('form-product').reset();
  
  const catSelect = document.getElementById('prod-cat');
  if (catSelect && catSelect.options.length > 0) catSelect.selectedIndex = 0;

  document.getElementById('prod-preview-container').style.display = 'none';
  document.getElementById('prod-img-preview').src = '';
  document.getElementById('prod-img-status').textContent = '';

  setSwitchValue('prod-active-toggle', true);
  openModal('product');
};

window.openEditProductModal = async (id) => {
  const products = await NordicaStore.get('products');
  const p = products.find(x => x.id === id);
  if (!p) return;

  currentEditingId = id;
  uploadedImageBase64 = p.image;

  document.getElementById('product-modal-title').textContent = "Edit Product Details";
  document.getElementById('prod-id').value = p.id;
  document.getElementById('prod-name').value = p.name;
  document.getElementById('prod-cat').value = p.categoryId;
  document.getElementById('prod-stock').value = p.stock;
  document.getElementById('prod-price').value = Math.round(p.price);
  document.getElementById('prod-old-price').value = p.oldPrice ? Math.round(p.oldPrice) : '';
  document.getElementById('prod-badge').value = p.badge || '';
  document.getElementById('prod-badge-type').value = p.badgeType || '';

  // Safely parse JSON strings
  const flavorsList = parseArray(p.flavors);
  const detailsList = parseArray(p.details);

  document.getElementById('prod-flavors').value = flavorsList.join(', ');
  document.getElementById('prod-desc').value = p.description || '';
  document.getElementById('prod-details').value = detailsList.join('\n');

  // Preview Image
  const preview = document.getElementById('prod-img-preview');
  preview.src = getImgUrl(p.image);
  document.getElementById('prod-preview-container').style.display = 'flex';
  document.getElementById('prod-img-status').textContent = p.image.startsWith('/uploads/') ? 'Stored on Server' : 'Linked Image';
  
  if (p.image.startsWith('http') || p.image.startsWith('/assets/')) {
    document.getElementById('prod-img-url').value = p.image;
  } else {
    document.getElementById('prod-img-url').value = '';
  }

  setSwitchValue('prod-active-toggle', p.active);
  openModal('product');
};

window.saveProductForm = async (event) => {
  event.preventDefault();

  const name = document.getElementById('prod-name').value;
  const categoryId = document.getElementById('prod-cat').value;
  const categoryName = document.getElementById('prod-cat').options[document.getElementById('prod-cat').selectedIndex].text;
  const stock = parseInt(document.getElementById('prod-stock').value);
  const price = parseFloat(document.getElementById('prod-price').value);
  const oldPriceVal = document.getElementById('prod-old-price').value;
  const oldPrice = oldPriceVal ? parseFloat(oldPriceVal) : null;
  const badge = (document.getElementById('prod-badge').value || '').trim() || null;
  const badgeType = (document.getElementById('prod-badge-type').value || '').trim() || null;
  const flavors = document.getElementById('prod-flavors').value.split(',').map(f => f.trim()).filter(Boolean);
  const description = document.getElementById('prod-desc').value;
  const details = document.getElementById('prod-details').value.split('\n').map(d => d.trim()).filter(Boolean);
  const active = getSwitchValue('prod-active-toggle');

  // For new products, image is required. For edits, we keep existing image if none provided
  if (!uploadedImageBase64 && !currentEditingId) {
    showToast("Please upload an image or provide an image URL.", "warning");
    return;
  }

  // For edits with no new image, fetch the current product and use its image
  let finalImage = uploadedImageBase64;
  if (currentEditingId && !uploadedImageBase64) {
    const products = await NordicaStore.get('products');
    const currentProduct = products.find(p => p.id === currentEditingId);
    if (currentProduct) {
      finalImage = currentProduct.image;
    }
  }

  const payload = {
    name, categoryId, categoryName, stock, price, oldPrice,
    badge, badgeType, flavors, description, details, active,
    image: finalImage || ''
  };

  // Debug logging to verify badge is being sent
  console.log('Saving product:', { badge, badgeType, payload });

  if (currentEditingId) {
    const result = await NordicaStore.update('products', currentEditingId, payload);
    if (result) {
      console.log('Update successful, result:', result);
      showToast("Product updated successfully!", "success");
    } else {
      console.error('Update failed - no result returned');
      showToast("Failed to update product. Check console for details.", "error");
      return;
    }
  } else {
    payload.id = 'prod-' + Date.now();
    payload.rating = 5.0;
    payload.reviews = 1;
    payload.createdAt = NordicaStore.today();
    const result = await NordicaStore.add('products', payload);
    if (result) {
      console.log('Add successful, result:', result);
      showToast("New product added to inventory!", "success");
    } else {
      console.error('Add failed - no result returned');
      showToast("Failed to add product. Check console for details.", "error");
      return;
    }
  }

  closeModal('product');
  await renderProductsList();
  await updateSidebarBadges();
};

// Toggle product stock status (in stock / out of stock)
window.toggleProductStock = async (productId) => {
  const products = await NordicaStore.get('products');
  const product = products.find(p => p.id === productId);
  
  if (!product) return;
  
  // Toggle: if in stock, set to 0; if out of stock, set to 1
  const newStock = product.stock > 0 ? 0 : 1;
  
  const updated = await NordicaStore.patch('products', productId, { stock: newStock });
  
  if (updated) {
    showToast(`Product marked as ${newStock > 0 ? 'In Stock' : 'Out of Stock'}`, 'success');
    await renderProductsList();
  } else {
    showToast('Failed to update product stock status', 'error');
  }
};

// =========================================================
// CATEGORIES CRUD OPERATIONS
// =========================================================
async function renderCategoriesList() {
  const categories = await NordicaStore.get('categories');
  const products = await NordicaStore.get('products');
  const grid = document.getElementById('cat-grid-body');
  const emptyView = document.getElementById('categories-empty');

  if (!grid) return;

  const searchQuery = document.getElementById('search-categories').value.toLowerCase();

  let filtered = categories.filter(c => {
    return (c.name || '').toLowerCase().includes(searchQuery) || (c.description || '').toLowerCase().includes(searchQuery);
  });

  document.getElementById('count-categories').textContent = filtered.length;

  if (filtered.length === 0) {
    grid.innerHTML = '';
    emptyView.style.display = 'block';
    return;
  }
  emptyView.style.display = 'grid';

  grid.innerHTML = filtered.map(c => {
    const prodCount = products.filter(p => p.categoryId === c.id).length;
    const catIconHtml = c.icon && /^fa-[a-z0-9-]+$/.test(c.icon) ? `<i class="fas ${escapeHtml(c.icon)}"></i>` : escapeHtml(c.icon || '📦');
    return `
      <div class="cat-admin-card">
        <img src="${escapeHtml(getImgUrl(c.image))}" alt="${escapeHtml(c.name)}" class="cat-admin-img" onerror="this.src='../assets/logo.png'">
        <div class="cat-admin-body">
          <div class="cat-admin-icon">${catIconHtml}</div>
          <div class="cat-admin-name">${escapeHtml(c.name)}</div>
          <div class="cat-admin-desc">${escapeHtml(c.description || 'No description provided.')}</div>
          <div style="font-size:0.75rem; font-weight:700; color:var(--red); margin-bottom:12px;">
            ${prodCount} products in category
          </div>
          <div class="cat-admin-actions">
            <button class="topbar-btn topbar-btn-ghost" style="flex:1; justify-content:center; padding: 6px 0;" onclick="openEditCategoryModal(${jsStringArg(c.id)})"><i class="fas fa-edit"></i> Edit</button>
            <button class="topbar-btn topbar-btn-ghost" style="flex:1; justify-content:center; padding: 6px 0; border-color: rgba(232,0,13,0.2); color: var(--red);" onclick="confirmDelete('categories', ${jsStringArg(c.id)}, renderCategoriesList)"><i class="fas fa-trash-alt"></i> Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.openAddCategoryModal = () => {
  currentEditingId = null;
  uploadedImageBase64 = null;
  document.getElementById('category-modal-title').textContent = "Add Product Category";
  document.getElementById('form-category').reset();
  document.getElementById('cat-preview-container').style.display = 'none';
  document.getElementById('cat-img-preview').src = '';
  openModal('category');
};

window.openEditCategoryModal = async (id) => {
  const categories = await NordicaStore.get('categories');
  const c = categories.find(x => x.id === id);
  if (!c) return;

  currentEditingId = id;
  uploadedImageBase64 = c.image;

  document.getElementById('category-modal-title').textContent = "Edit Category Details";
  document.getElementById('cat-id').value = c.id;
  document.getElementById('cat-name').value = c.name;
  document.getElementById('cat-desc').value = c.description || '';

  const preview = document.getElementById('cat-img-preview');
  preview.src = getImgUrl(c.image);
  document.getElementById('cat-preview-container').style.display = 'flex';
  document.getElementById('cat-img-status').textContent = c.image.startsWith('/uploads/') ? 'Stored on Server' : 'Linked Image';

  if (c.image.startsWith('http') || c.image.startsWith('/assets/')) {
    document.getElementById('cat-img-url').value = c.image;
  } else {
    document.getElementById('cat-img-url').value = '';
  }

  openModal('category');
};

window.saveCategoryForm = async (event) => {
  event.preventDefault();

  const name = document.getElementById('cat-name').value;
  const description = document.getElementById('cat-desc').value;

  if (!uploadedImageBase64 && !currentEditingId) {
    showToast("Please upload an image or provide a category banner URL.", "warning");
    return;
  }

  // Keep the existing image on edits when no replacement was provided.
  const categories = currentEditingId ? await NordicaStore.get('categories') : [];
  const currentCategory = categories.find(c => c.id === currentEditingId);
  let finalImage = uploadedImageBase64;
  if (currentEditingId && !uploadedImageBase64 && currentCategory) {
    finalImage = currentCategory.image;
  }

  const payload = {
    name, description, image: finalImage || ''
  };

  let saved;
  if (currentEditingId) {
    saved = await NordicaStore.update('categories', currentEditingId, payload);
  } else {
    payload.id = 'cat-' + Date.now();
    payload.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    saved = await NordicaStore.add('categories', payload);
  }
  if (!saved) return showToast('Could not save the category. Check the name and image, then retry.', 'error');
  showToast(currentEditingId ? 'Category updated successfully!' : 'Category added successfully!', 'success');

  closeModal('category');
  await renderCategoriesList();
};

// =========================================================
// BUNDLES & PROMOPACKS CRUD
// =========================================================
async function renderPacksList() {
  const packs = await NordicaStore.get('packs');
  const tbody = document.getElementById('table-packs-body');
  const emptyView = document.getElementById('packs-empty');

  if (!tbody) return;

  const searchQuery = document.getElementById('search-packs').value.toLowerCase();

  let filtered = packs.filter(p => {
    return (p.name || '').toLowerCase().includes(searchQuery) || (p.description || '').toLowerCase().includes(searchQuery);
  });

  document.getElementById('count-packs').textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyView.style.display = 'block';
    return;
  }
  emptyView.style.display = 'none';

  tbody.innerHTML = filtered.map(p => {
    // Safely parse JSON
    const productNamesList = parseArray(p.productNames);
    const packIconHtml = p.emoji && /^fa-[a-z0-9-]+$/.test(p.emoji) ? `<i class="fas ${escapeHtml(p.emoji)}"></i>` : escapeHtml(p.emoji || '💪');

    return `
      <tr>
        <td>
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="font-size:1.6rem; background:var(--black-3); padding:8px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06);">${packIconHtml}</div>
            <div style="font-weight:700; color:var(--white);">${escapeHtml(p.name)}</div>
          </div>
        </td>
        <td style="max-width:260px; font-size:0.8rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(p.description)}">${escapeHtml(p.description)}</td>
        <td style="font-size:0.8rem; line-height:1.4;">
          ${productNamesList.map(item => `• ${escapeHtml(item)}`).join('<br>')}
        </td>
        <td style="font-weight:700; color:var(--white);">${Math.round(p.price).toLocaleString()} DT</td>
        <td style="text-decoration:line-through; font-size:0.8rem;">${Math.round(p.originalPrice).toLocaleString()} DT</td>
        <td style="font-weight:700; color:var(--green);">${Math.round(p.savings).toLocaleString()} DT</td>
        <td>
          <span class="badge-status ${p.active ? 'active' : 'inactive'}">
            ${p.active ? 'Active' : 'Disabled'}
          </span>
        </td>
        <td>
          <div class="action-btns">
            <button class="action-icon-btn edit" onclick="openEditPackModal(${jsStringArg(p.id)})" title="Edit Pack"><i class="fas fa-edit"></i></button>
            <button class="action-icon-btn delete" onclick="confirmDelete('packs', ${jsStringArg(p.id)}, renderPacksList)" title="Delete Pack"><i class="fas fa-trash-alt"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.calculateSavings = () => {
  const p = parseFloat(document.getElementById('pack-price').value) || 0;
  const orig = parseFloat(document.getElementById('pack-orig-price').value) || 0;
  document.getElementById('pack-savings').value = Math.max(0, orig - p);
};

async function populatePackProductsCheckboxes(selectedNames = []) {
  const products = await NordicaStore.get('products');
  const activeProducts = products.filter(p => p.active);
  const container = document.getElementById('pack-products-checkboxes');
  if (!container) return;

  container.innerHTML = activeProducts.map(p => {
    const isChecked = selectedNames.some(name => name.toLowerCase().trim() === p.name.toLowerCase().trim());
    return `
      <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; color:var(--gray-light); cursor:pointer;">
        <input type="checkbox" name="pack-products" value="${escapeHtml(p.name)}" ${isChecked ? 'checked' : ''} style="cursor:pointer; accent-color:var(--red);">
        <span>${escapeHtml(p.name)}</span>
      </label>
    `;
  }).join('');
}

window.openAddPackModal = async () => {
  currentEditingId = null;
  document.getElementById('pack-modal-title').textContent = "Create Promo Pack";
  document.getElementById('form-pack').reset();
  
  await populatePackProductsCheckboxes([]);
  document.getElementById('pack-custom-items').value = '';

  setSwitchValue('pack-active-toggle', true);
  openModal('pack');
};

window.openEditPackModal = async (id) => {
  const packs = await NordicaStore.get('packs');
  const p = packs.find(x => x.id === id);
  if (!p) return;

  currentEditingId = id;

  document.getElementById('pack-modal-title').textContent = "Modify Promo Pack";
  document.getElementById('pack-id').value = p.id;
  document.getElementById('pack-name').value = p.name;
  document.getElementById('pack-emoji').value = p.emoji;
  document.getElementById('pack-desc').value = p.description;

  const productNamesList = parseArray(p.productNames);
  
  // Find which items are custom items (do not match any database product name)
  const products = await NordicaStore.get('products');
  const dbProductNames = products.map(prod => prod.name.toLowerCase().trim());
  
  const customItems = productNamesList.filter(name => !dbProductNames.includes(name.toLowerCase().trim()));
  document.getElementById('pack-custom-items').value = customItems.join('\n');

  await populatePackProductsCheckboxes(productNamesList);

  document.getElementById('pack-price').value = Math.round(p.price);
  document.getElementById('pack-orig-price').value = Math.round(p.originalPrice);
  document.getElementById('pack-savings').value = Math.round(p.savings);

  setSwitchValue('pack-active-toggle', p.active);
  openModal('pack');
};

window.savePackForm = async (event) => {
  event.preventDefault();

  const name = document.getElementById('pack-name').value;
  const emoji = document.getElementById('pack-emoji').value;
  const description = document.getElementById('pack-desc').value;
  
  // Collect checked products
  const checkedBoxes = document.querySelectorAll('input[name="pack-products"]:checked');
  const selectedProductNames = Array.from(checkedBoxes).map(cb => cb.value);
  
  // Collect custom items
  const customItems = document.getElementById('pack-custom-items').value.split('\n').map(n => n.trim()).filter(Boolean);
  
  // Combine lists
  const productNames = [...selectedProductNames, ...customItems];

  const price = parseFloat(document.getElementById('pack-price').value);
  const originalPrice = parseFloat(document.getElementById('pack-orig-price').value);
  const savings = Math.max(0, originalPrice - price);
  const active = getSwitchValue('pack-active-toggle');

  const payload = {
    name, emoji, description, productNames, price, originalPrice, savings, active,
    products: [] 
  };

  let saved;
  if (currentEditingId) {
    saved = await NordicaStore.update('packs', currentEditingId, payload);
  } else {
    payload.id = 'pack-' + Date.now();
    payload.createdAt = NordicaStore.today();
    saved = await NordicaStore.add('packs', payload);
  }
  if (!saved) return showToast('Could not save the pack. Check its prices and try again.', 'error');
  showToast(currentEditingId ? 'Pack stack updated successfully!' : 'Custom promo pack bundle created!', 'success');

  closeModal('pack');
  await renderPacksList();
};

// =========================================================
// CUSTOMER PROFILES CRUD
// =========================================================
async function renderUsersList() {
  const users = await NordicaStore.get('users');
  const tbody = document.getElementById('table-users-body');
  const emptyView = document.getElementById('users-empty');

  if (!tbody) return;

  const searchQuery = document.getElementById('search-users').value.toLowerCase();
  const statusFilter = document.getElementById('filter-users-status').value;

  let filtered = users.filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(searchQuery) ||
                          u.email.toLowerCase().includes(searchQuery) ||
                          (u.phone || '').includes(searchQuery) ||
                          (u.wilaya || '').toLowerCase().includes(searchQuery);

    let matchesStatus = true;
    if (statusFilter === 'active') matchesStatus = u.active;
    if (statusFilter === 'inactive') matchesStatus = !u.active;

    return matchesSearch && matchesStatus;
  });

  document.getElementById('count-users').textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyView.style.display = 'block';
    return;
  }
  emptyView.style.display = 'none';

  tbody.innerHTML = filtered.map(u => `
    <tr>
      <td class="td-name">${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(u.phone)}</td>
      <td>${escapeHtml(u.wilaya)}</td>
      <td style="font-weight:700;">${u.orders || 0} orders</td>
      <td style="font-weight:700; color:var(--white);">${Math.round(u.totalSpent || 0).toLocaleString()} DT</td>
      <td>
        <span class="badge-status ${u.active ? 'active' : 'inactive'}">
          ${u.active ? 'Active' : 'Suspended'}
        </span>
      </td>
      <td>
        <div class="action-btns">
          <button class="action-icon-btn edit" onclick="openEditUserModal(${jsStringArg(u.id)})" title="Edit Customer"><i class="fas fa-edit"></i></button>
          <button class="action-icon-btn delete" onclick="confirmDelete('users', ${jsStringArg(u.id)}, renderUsersList)" title="Delete Customer"><i class="fas fa-trash-alt"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.openAddUserModal = () => {
  currentEditingId = null;
  document.getElementById('user-modal-title').textContent = "Create Customer Profile";
  document.getElementById('form-user').reset();
  const passEl = document.getElementById('usr-password');
  if (passEl) {
    passEl.value = '';
    passEl.required = true;
  }
  setSwitchValue('usr-active-toggle', true);
  openModal('user');
};

window.openEditUserModal = async (id) => {
  const users = await NordicaStore.get('users');
  const u = users.find(x => x.id === id);
  if (!u) return;

  currentEditingId = id;

  document.getElementById('user-modal-title').textContent = "Edit Customer Profile";
  document.getElementById('usr-id').value = u.id;
  document.getElementById('usr-name').value = u.name;
  document.getElementById('usr-email').value = u.email;
  document.getElementById('usr-phone').value = u.phone;
  document.getElementById('usr-wilaya').value = u.wilaya;
  document.getElementById('usr-orders').value = u.orders;
  document.getElementById('usr-spent').value = Math.round(u.totalSpent);

  const passEl = document.getElementById('usr-password');
  if (passEl) {
    passEl.value = '';
    passEl.required = false;
  }

  setSwitchValue('usr-active-toggle', u.active);
  openModal('user');
};

window.saveUserForm = async (event) => {
  event.preventDefault();

  const name = document.getElementById('usr-name').value;
  const email = document.getElementById('usr-email').value;
  const phone = document.getElementById('usr-phone').value;
  const wilaya = document.getElementById('usr-wilaya').value;
  const orders = parseInt(document.getElementById('usr-orders').value) || 0;
  const totalSpent = parseFloat(document.getElementById('usr-spent').value) || 0;
  const active = getSwitchValue('usr-active-toggle');
  const passwordVal = document.getElementById('usr-password').value;

  const payload = {
    name, email, phone, wilaya, orders, totalSpent, active
  };

  if (passwordVal) {
    payload.password = passwordVal;
  }

  let saved;
  if (currentEditingId) {
    saved = await NordicaStore.update('users', currentEditingId, payload);
  } else {
    payload.id = 'usr-' + Date.now();
    payload.joinedAt = NordicaStore.today();
    saved = await NordicaStore.add('users', payload);
  }
  if (!saved) return showToast('Could not save the customer. Check the details and try again.', 'error');
  showToast(currentEditingId ? 'Customer profile updated!' : 'Registered new customer account!', 'success');

  closeModal('user');
  await renderUsersList();
  await initOverviewData();
};

// =========================================================
// DELIVERIES & PRINT INVOICES
// =========================================================
async function renderDeliveriesList() {
  const deliveries = await NordicaStore.get('deliveries');
  const tbody = document.getElementById('table-deliveries-body');
  const emptyView = document.getElementById('deliveries-empty');

  if (!tbody) return;

  const searchQuery = document.getElementById('search-deliveries').value.toLowerCase();
  const statusFilter = document.getElementById('filter-deliveries-status').value;

  let filtered = deliveries.filter(d => {
    const matchesSearch = (d.customer || '').toLowerCase().includes(searchQuery) ||
                          (d.phone || '').includes(searchQuery) ||
                          (d.id || '').toLowerCase().includes(searchQuery) ||
                          (d.products || '').toLowerCase().includes(searchQuery) ||
                          (d.wilaya || '').toLowerCase().includes(searchQuery);

    const matchesStatus = (statusFilter === 'all' || d.status === statusFilter);

    return matchesSearch && matchesStatus;
  });

  document.getElementById('count-deliveries').textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyView.style.display = 'block';
    return;
  }
  emptyView.style.display = 'none';

  tbody.innerHTML = filtered.map(d => `
    <tr>
      <td style="font-family: monospace; font-weight:700; color:var(--white);">${escapeHtml(d.id)}</td>
      <td>
        <div style="font-weight:700; color:var(--white);">${escapeHtml(d.customer)}</div>
        <div style="font-size:0.75rem; color:var(--gray);">${escapeHtml(d.phone)}</div>
      </td>
      <td>
        <div style="font-weight:600; color:var(--white);">${escapeHtml(d.wilaya)}</div>
        <div style="font-size:0.75rem; color:var(--gray); max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(d.address)}">${escapeHtml(d.address)}</div>
      </td>
      <td style="font-size:0.8rem; color:var(--gray-light);">${escapeHtml(d.products)}</td>
      <td style="font-weight:700; color:var(--white);">${Math.round(d.amount).toLocaleString()} DT</td>
      <td style="text-transform: capitalize;">${d.method === 'home' ? '🏠 Home' : '📦 Relay Office'}</td>
      <td style="font-family: monospace; font-size:0.8rem;">${escapeHtml(d.trackingCode || '—')}</td>
      <td>
        <select class="status-select ${escapeHtml(d.status)}" onchange="changeDeliveryStatus(${jsStringArg(d.id)}, this.value)" style="border-radius:6px; font-weight:700;">
          <option value="pending" ${d.status==='pending'?'selected':''}>Pending</option>
          <option value="in-transit" ${d.status==='in-transit'?'selected':''}>In Transit</option>
          <option value="delivered" ${d.status==='delivered'?'selected':''}>Delivered</option>
          <option value="cancelled" ${d.status==='cancelled'?'selected':''}>Cancelled</option>
        </select>
      </td>
      <td>
        <div class="action-btns">
          <button class="action-icon-btn edit" onclick="openEditDeliveryModal(${jsStringArg(d.id)})" title="Edit Record"><i class="fas fa-edit"></i></button>
          <button class="action-icon-btn print" onclick="printInvoicePDF(${jsStringArg(d.id)})" title="Print Invoice (System Layout)"><i class="fas fa-print"></i></button>
          <button class="action-icon-btn print" onclick="downloadInvoicePDF(${jsStringArg(d.id)})" title="Download PDF Document" style="color: #FF5A60;"><i class="fas fa-file-pdf"></i></button>
          <button class="action-icon-btn delete" onclick="confirmDelete('deliveries', ${jsStringArg(d.id)}, renderDeliveriesList)" title="Delete Shipment"><i class="fas fa-trash-alt"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.changeDeliveryStatus = async (id, newStatus) => {
  // Fetch the full delivery record first
  const deliveries = await NordicaStore.get('deliveries');
  const delivery = deliveries.find(d => d.id === id);
  if (!delivery) {
    showToast("Delivery record not found!", "error");
    return;
  }

  // Build complete payload with all fields
  const payload = {
    customer: delivery.customer,
    phone: delivery.phone,
    wilaya: delivery.wilaya,
    address: delivery.address,
    products: delivery.products,
    amount: delivery.amount,
    method: delivery.method,
    trackingCode: delivery.trackingCode,
    notes: delivery.notes,
    status: newStatus,
    deliveredAt: newStatus === 'delivered' ? NordicaStore.today() : null
  };

  const saved = await NordicaStore.update('deliveries', id, payload);
  if (!saved) return showToast('Could not update this delivery. Please retry.', 'error');
  showToast(`Delivery status updated to ${newStatus}!`, "success");
  
  await renderDeliveriesList();
  await initOverviewData();
  await updateSidebarBadges();
};

window.openAddDeliveryModal = () => {
  currentEditingId = null;
  document.getElementById('delivery-modal-title').textContent = "Create Shipment Delivery";
  document.getElementById('form-delivery').reset();
  
  document.getElementById('del-order-id').value = 'ORD-' + Math.floor(Math.random() * 100000);
  document.getElementById('del-status').value = 'pending';
  document.getElementById('del-method').value = 'home';
  
  openModal('delivery');
};

window.openEditDeliveryModal = async (id) => {
  const deliveries = await NordicaStore.get('deliveries');
  const d = deliveries.find(x => x.id === id);
  if (!d) return;

  currentEditingId = id;

  document.getElementById('delivery-modal-title').textContent = "Modify Shipment Record";
  document.getElementById('del-id').value = d.id;
  document.getElementById('del-order-id').value = d.orderId;
  document.getElementById('del-customer').value = d.customer;
  document.getElementById('del-phone').value = d.phone;
  document.getElementById('del-wilaya').value = d.wilaya;
  document.getElementById('del-address').value = d.address;
  document.getElementById('del-products').value = d.products;
  document.getElementById('del-amount').value = Math.round(d.amount);
  document.getElementById('del-method').value = d.method;
  document.getElementById('del-tracking').value = d.trackingCode || '';
  document.getElementById('del-status').value = d.status;
  document.getElementById('del-notes').value = d.notes || '';

  openModal('delivery');
};

window.saveDeliveryForm = async (event) => {
  event.preventDefault();

  const customer = document.getElementById('del-customer').value;
  const phone = document.getElementById('del-phone').value;
  const wilaya = document.getElementById('del-wilaya').value;
  const address = document.getElementById('del-address').value;
  const products = document.getElementById('del-products').value;
  const amount = parseFloat(document.getElementById('del-amount').value);
  const method = document.getElementById('del-method').value;
  const trackingCode = document.getElementById('del-tracking').value;
  const status = document.getElementById('del-status').value;
  const notes = document.getElementById('del-notes').value;
  const orderId = document.getElementById('del-order-id').value;

  // Format date correctly
  const formattedDate = (d) => d ? (d.includes('T') ? d.split('T')[0] : d) : null;

  const payload = {
    customer, phone, wilaya, address, products, amount, method, trackingCode, status, notes
  };

  let saved;
  if (currentEditingId) {
    payload.deliveredAt = status === 'delivered' ? NordicaStore.today() : null;
    saved = await NordicaStore.update('deliveries', currentEditingId, payload);
  } else {
    payload.id = 'DEL-' + Math.floor(100 + Math.random() * 900);
    payload.orderId = orderId;
    payload.createdAt = NordicaStore.today();
    payload.deliveredAt = status === 'delivered' ? NordicaStore.today() : null;
    saved = await NordicaStore.add('deliveries', payload);
  }
  if (!saved) return showToast('Could not save this delivery. Check the details and try again.', 'error');
  showToast(currentEditingId ? 'Shipment delivery modified!' : 'Shipment delivery registered successfully!', 'success');

  closeModal('delivery');
  await renderDeliveriesList();
  await initOverviewData();
  await updateSidebarBadges();
};

// =========================================================
// PDF INVOICE GENERATOR & PRINT SYSTEM
// =========================================================
window.printInvoicePDF = async (id) => {
  const deliveries = await NordicaStore.get('deliveries');
  const d = deliveries.find(x => x.id === id);
  if (!d) return;

  const printArea = document.getElementById('printArea');
  if (!printArea) return;

  const subtotal = parseFloat(d.amount);
  const shippingCost = subtotal > 300 ? 0 : 8; 
  const totalAmount = subtotal + shippingCost;

  // Render printable receipt invoice inside hidden printArea DOM
  printArea.innerHTML = `
    <div style="font-family:'Outfit', Arial, sans-serif; color:#000; background:#fff; padding:20px; line-height:1.5;">
      <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
        <tr>
          <td style="vertical-align:top;">
            <div style="font-size:26px; font-weight:800; letter-spacing:2px; color:#E8000D;">NORDICA NUTRITION</div>
            <div style="font-size:10px; color:#555; text-transform:uppercase; letter-spacing:1px; margin-top:2px;">Fuel Your Legend Store</div>
            <div style="font-size:12px; color:#555; margin-top:10px;">
              Tunisia Delivery Services<br>
              Email: delivery@nordicanutrition.tn<br>
              Phone: +216 78 456 123
            </div>
          </td>
          <td style="text-align:right; vertical-align:top;">
            <div style="font-size:18px; font-weight:700; color:#E8000D;">INVOICE / RECEIPT</div>
            <table style="margin-left:auto; border-collapse:collapse; margin-top:10px; font-size:12px; text-align:left;">
              <tr><td style="padding:2px 8px; font-weight:700;">Delivery ID:</td><td style="padding:2px 8px; font-family:monospace;">${escapeHtml(d.id)}</td></tr>
              <tr><td style="padding:2px 8px; font-weight:700;">Order Code:</td><td style="padding:2px 8px; font-family:monospace;">${escapeHtml(d.orderId)}</td></tr>
              <tr><td style="padding:2px 8px; font-weight:700;">Issue Date:</td><td style="padding:2px 8px;">${d.createdAt ? d.createdAt.split('T')[0] : ''}</td></tr>
              <tr><td style="padding:2px 8px; font-weight:700;">Tracking No:</td><td style="padding:2px 8px; font-family:monospace;">${escapeHtml(d.trackingCode || 'Pending Assignment')}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <div style="border-top:2px solid #E8000D; border-bottom:2px solid #E8000D; padding:12px 0; margin-bottom:20px; display:flex; justify-content:space-between; font-size:12px;">
        <div style="flex:1;">
          <div style="font-weight:700; color:#E8000D; text-transform:uppercase; margin-bottom:5px;">SHIPPED TO:</div>
          <div style="font-size:14px; font-weight:700; color:#000;">${escapeHtml(d.customer)}</div>
          <div>Phone: ${escapeHtml(d.phone)}</div>
          <div>Address: ${escapeHtml(d.address)}</div>
          <div>Governorate: ${escapeHtml(d.wilaya)}</div>
        </div>
        <div style="flex:1; text-align:right;">
          <div style="font-weight:700; color:#E8000D; text-transform:uppercase; margin-bottom:5px;">DELIVERY METHOD:</div>
          <div style="font-size:14px; font-weight:700; color:#000; text-transform:capitalize;">${d.method === 'home' ? '🏠 Home Delivery' : '📦 Relay Point Office'}</div>
          <div style="margin-top:8px; font-size:11px;">
            Status: <strong style="text-transform:uppercase; color:#E8000D;">${escapeHtml(d.status)}</strong>
          </div>
        </div>
      </div>

      <div style="margin-bottom:30px;">
        <div style="font-weight:700; color:#E8000D; text-transform:uppercase; font-size:12px; margin-bottom:8px;">ITEMS DETAILS</div>
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="background:#E8000D; color:#fff;">
              <th style="padding:8px; text-align:left; font-weight:700;">Description</th>
              <th style="padding:8px; text-align:center; font-weight:700; width:80px;">Qty</th>
              <th style="padding:8px; text-align:right; font-weight:700; width:120px;">Price</th>
              <th style="padding:8px; text-align:right; font-weight:700; width:120px;">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px solid #ddd;">
              <td style="padding:10px 8px; font-weight:700;">${escapeHtml(d.products)}</td>
              <td style="padding:10px 8px; text-align:center;">1</td>
              <td style="padding:10px 8px; text-align:right;">${Math.round(subtotal).toLocaleString()} DT</td>
              <td style="padding:10px 8px; text-align:right;">${Math.round(subtotal).toLocaleString()} DT</td>
            </tr>
          </tbody>
        </table>
      </div>

      <table style="width:40%; margin-left:auto; border-collapse:collapse; font-size:13px; margin-bottom:40px;">
        <tr style="border-bottom:1px solid #ddd;"><td style="padding:6px 0; font-weight:600;">Subtotal:</td><td style="text-align:right; padding:6px 0;">${Math.round(subtotal).toLocaleString()} DT</td></tr>
        <tr style="border-bottom:1px solid #ddd;"><td style="padding:6px 0; font-weight:600;">Delivery Fee:</td><td style="text-align:right; padding:6px 0;">${shippingCost === 0 ? 'FREE' : Math.round(shippingCost).toLocaleString() + ' DT'}</td></tr>
        <tr style="font-size:16px; font-weight:800; color:#E8000D;"><td style="padding:10px 0;">Total Amount:</td><td style="text-align:right; padding:10px 0;">${Math.round(totalAmount).toLocaleString()} DT</td></tr>
      </table>

      ${d.notes ? `
      <div style="background:#f9f9f9; border:1px solid #ddd; padding:10px 14px; border-radius:6px; font-size:11px; margin-bottom:40px;">
        <strong style="color:#E8000D;">SHIPMENT NOTES:</strong> ${escapeHtml(d.notes)}
      </div>
      ` : ''}

      <div style="display:flex; justify-content:space-between; margin-top:60px; font-size:12px; text-align:center;">
        <div style="width:200px;">
          <div style="border-bottom:1px solid #000; height:40px;"></div>
          <div style="margin-top:6px; font-weight:600;">Courier Signature</div>
        </div>
        <div style="width:200px;">
          <div style="border-bottom:1px solid #000; height:40px;"></div>
          <div style="margin-top:6px; font-weight:600;">Customer Signature</div>
        </div>
      </div>

      <div style="text-align:center; font-size:10px; color:#777; margin-top:80px; border-top:1px solid #eee; padding-top:10px;">
        Thank you for shopping at Nordica Nutrition. Stay powerful!
      </div>
    </div>
  `;

  // Display printable area
  printArea.style.display = 'block';
  
  // Call system print
  setTimeout(() => {
    window.print();
    printArea.style.display = 'none';
  }, 100);
};

window.printAllDeliveries = async () => {
  const deliveries = await NordicaStore.get('deliveries');
  const printArea = document.getElementById('printArea');
  if (!printArea) return;

  printArea.innerHTML = `
    <div style="font-family:'Outfit', Arial, sans-serif; color:#000; background:#fff; padding:20px;">
      <h2 style="color:#E8000D; border-bottom:2px solid #E8000D; padding-bottom:10px;">Nordica Nutrition - Shipment Deliveries List</h2>
      <p style="font-size:12px; color:#555;">Export Date: ${NordicaStore.today()} • Total Deliveries: ${deliveries.length}</p>
      
      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:20px;">
        <thead>
          <tr style="background:#E8000D; color:#white; font-weight:700;">
            <th style="padding:8px; border:1px solid #ddd; text-align:left;">ID</th>
            <th style="padding:8px; border:1px solid #ddd; text-align:left;">Customer</th>
            <th style="padding:8px; border:1px solid #ddd; text-align:left;">Wilaya</th>
            <th style="padding:8px; border:1px solid #ddd; text-align:left;">Products</th>
            <th style="padding:8px; border:1px solid #ddd; text-align:right;">Amount</th>
            <th style="padding:8px; border:1px solid #ddd; text-align:left;">Method</th>
            <th style="padding:8px; border:1px solid #ddd; text-align:left;">Tracking</th>
            <th style="padding:8px; border:1px solid #ddd; text-align:left;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${deliveries.map(d => `
            <tr>
              <td style="padding:6px; border:1px solid #ddd; font-family:monospace;">${escapeHtml(d.id)}</td>
              <td style="padding:6px; border:1px solid #ddd;">${escapeHtml(d.customer)} (${escapeHtml(d.phone)})</td>
              <td style="padding:6px; border:1px solid #ddd;">${escapeHtml(d.wilaya)}</td>
              <td style="padding:6px; border:1px solid #ddd;">${escapeHtml(d.products)}</td>
              <td style="padding:6px; border:1px solid #ddd; text-align:right;">${Math.round(d.amount).toLocaleString()} DT</td>
              <td style="padding:6px; border:1px solid #ddd; text-transform:capitalize;">${escapeHtml(d.method)}</td>
              <td style="padding:6px; border:1px solid #ddd; font-family:monospace;">${escapeHtml(d.trackingCode || '—')}</td>
              <td style="padding:6px; border:1px solid #ddd; font-weight:700; text-transform:uppercase;">${escapeHtml(d.status)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  printArea.style.display = 'block';
  setTimeout(() => {
    window.print();
    printArea.style.display = 'none';
  }, 100);
};

window.downloadInvoicePDF = async (id) => {
  const deliveries = await NordicaStore.get('deliveries');
  const d = deliveries.find(x => x.id === id);
  if (!d) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFont("helvetica", "normal");

  // Title
  doc.setFontSize(22);
  doc.setTextColor(232, 0, 13);
  doc.text("NORDICA NUTRITION", 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text("FUEL YOUR LEGEND STORE", 14, 25);

  // Invoice info
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text("INVOICE / RECEIPT", 140, 20);

  doc.setFontSize(10);
  doc.text(`Delivery ID: ${d.id}`, 140, 26);
  doc.text(`Order Code: ${d.orderId}`, 140, 32);
  const dateStr = d.createdAt ? (d.createdAt.includes('T') ? d.createdAt.split('T')[0] : d.createdAt) : '';
  doc.text(`Issue Date: ${dateStr}`, 140, 38);
  doc.text(`Tracking: ${d.trackingCode || 'Pending'}`, 140, 44);

  // Divider line
  doc.setDrawColor(232, 0, 13);
  doc.setLineWidth(0.5);
  doc.line(14, 50, 196, 50);

  // Bill to
  doc.setFontSize(12);
  doc.setTextColor(232, 0, 13);
  doc.text("SHIPPED TO:", 14, 60);

  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text(`Name: ${d.customer}`, 14, 66);
  doc.text(`Phone: ${d.phone}`, 14, 72);
  doc.text(`Address: ${d.address}`, 14, 78);
  doc.text(`Governorate: ${d.wilaya}`, 14, 84);

  // Delivery method
  doc.setFontSize(12);
  doc.setTextColor(232, 0, 13);
  doc.text("DELIVERY INFO:", 110, 60);

  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  const methodText = d.method === 'home' ? 'Home Delivery' : 'Relay Point Office';
  doc.text(`Method: ${methodText}`, 110, 66);
  doc.text(`Status: ${d.status.toUpperCase()}`, 110, 72);

  // Divider line
  doc.setDrawColor(200, 200, 200);
  doc.line(14, 92, 196, 92);

  // Items table headers
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.setFillColor(232, 0, 13);
  doc.rect(14, 100, 182, 8, "F");
  doc.text("Description", 18, 105);
  doc.text("Qty", 130, 105);
  doc.text("Total Price", 160, 105);

  // Items row
  doc.setTextColor(0, 0, 0);
  doc.text(d.products, 18, 116);
  doc.text("1", 132, 116);
  doc.text(`${Math.round(d.amount).toLocaleString()} DT`, 160, 116);

  doc.line(14, 122, 196, 122);

  // Pricing Totals
  const subtotal = parseFloat(d.amount);
  const shippingCost = subtotal > 300 ? 0 : 8;
  const totalAmount = subtotal + shippingCost;

  doc.setFontSize(11);
  doc.text("Subtotal:", 120, 135);
  doc.text(`${Math.round(subtotal).toLocaleString()} DT`, 160, 135);

  doc.text("Delivery Fee:", 120, 142);
  doc.text(shippingCost === 0 ? "FREE" : `${Math.round(shippingCost).toLocaleString()} DT`, 160, 142);

  doc.setFontSize(12);
  doc.setTextColor(232, 0, 13);
  doc.text("Total Amount:", 120, 150);
  doc.text(`${Math.round(totalAmount).toLocaleString()} DT`, 160, 150);

  // Notes if any
  if (d.notes) {
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.setFillColor(245, 245, 245);
    doc.rect(14, 160, 182, 15, "F");
    doc.setTextColor(232, 0, 13);
    doc.text("COURIER NOTES:", 18, 165);
    doc.setTextColor(0, 0, 0);
    doc.text(d.notes, 18, 171);
  }

  // Thank you
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text("Thank you for shopping at Nordica Nutrition. Stay powerful!", 14, 190);

  doc.save(`Invoice-${d.id}.pdf`);
};

window.downloadDeliveriesPDF = async () => {
  const deliveries = await NordicaStore.get('deliveries');
  
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFont("helvetica", "normal");

  doc.setFontSize(18);
  doc.setTextColor(232, 0, 13);
  doc.text("Nordica Nutrition - Shipment Deliveries Summary", 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Export Date: ${NordicaStore.today()} | Total Deliveries: ${deliveries.length}`, 14, 26);

  // Table Headers
  doc.setFillColor(232, 0, 13);
  doc.rect(14, 34, 182, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text("ID", 16, 39);
  doc.text("Customer", 38, 39);
  doc.text("Governorate", 85, 39);
  doc.text("Amount", 125, 39);
  doc.text("Status", 155, 39);

  let y = 48;
  doc.setTextColor(0, 0, 0);

  for (const d of deliveries) {
    if (y > 275) {
      doc.addPage();
      // Repeat headers on new page
      doc.setFillColor(232, 0, 13);
      doc.rect(14, 20, 182, 8, "F");
      doc.setTextColor(255, 255, 255);
      doc.text("ID", 16, 25);
      doc.text("Customer", 38, 25);
      doc.text("Governorate", 85, 25);
      doc.text("Amount", 125, 25);
      doc.text("Status", 155, 25);
      y = 34;
      doc.setTextColor(0, 0, 0);
    }

    doc.text(d.id, 16, y);
    
    // Truncate customer name if too long
    const name = d.customer.length > 22 ? d.customer.substring(0, 20) + ".." : d.customer;
    doc.text(name, 38, y);
    
    doc.text(d.wilaya, 85, y);
    doc.text(`${Math.round(d.amount).toLocaleString()} DT`, 125, y);
    doc.text(d.status.toUpperCase(), 155, y);

    doc.setDrawColor(230, 230, 230);
    doc.line(14, y + 2, 196, y + 2);
    y += 10;
  }

  doc.save(`Deliveries-Summary-${NordicaStore.today()}.pdf`);
};

// =========================================================
// GENERIC MODALS INTERACTIVITY
// =========================================================
window.openModal = (id) => {
  const overlay = document.getElementById(`modal-${id}`);
  if (overlay) {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
};

window.closeModal = (id) => {
  const overlay = document.getElementById(`modal-${id}`);
  if (overlay) {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }
};

document.querySelectorAll('.admin-modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      const id = overlay.id.replace('modal-', '');
      closeModal(id);
    }
  });
});

window.confirmDelete = (key, id, callback) => {
  const confirmBtn = document.getElementById('btn-confirm-delete');
  activeDeleteTarget = { key, id, callback };
  
  confirmBtn.onclick = async () => {
    if (activeDeleteTarget) {
      const deleted = await NordicaStore.remove(activeDeleteTarget.key, activeDeleteTarget.id);
      if (!deleted) return showToast('Could not delete this item. Please retry.', 'error');
      showToast("Item permanently deleted from database.", "warning");
      if (activeDeleteTarget.callback) await activeDeleteTarget.callback();
      closeModal('confirm');
      await initOverviewData();
      await updateSidebarBadges();
      activeDeleteTarget = null;
    }
  };

  openModal('confirm');
};

// =========================================================
// TOAST NOTIFICATIONS SYSTEM
// =========================================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${type === 'success' ? '✓' : type === 'warning' ? '⚠' : '✕'}</div>
    <div class="toast-msg">${escapeHtml(message)}</div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toast-out 0.25s ease forwards';
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}
