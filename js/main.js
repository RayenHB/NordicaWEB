// =========================================
// NORDICA NUTRITION - Main JavaScript (PG)
// =========================================

document.addEventListener('DOMContentLoaded', () => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const safeImageUrl = value => {
    const url = String(value || '');
    if (/^(https?:\/\/|\/uploads\/|assets\/|data:image\/)/i.test(url)) return url;
    return 'assets/logo.png';
  };


  // ---- State ----
  let cart = [];
  try {
    const savedCart = JSON.parse(localStorage.getItem('nordica-cart') || '[]');
    if (Array.isArray(savedCart)) {
      cart = savedCart.filter(item => item && typeof item.id === 'string' && Number.isFinite(Number(item.price)) && Number(item.price) >= 0)
        .map(item => {
          const qty = Number(item.qty);
          return { ...item, qty: Math.min(99, Math.max(1, Number.isFinite(qty) ? Math.floor(qty) || 1 : 1)) };
        });
    }
  } catch (err) {
    localStorage.removeItem('nordica-cart');
  }
  let isSearchOpen = false;
  let isMobileMenuOpen = false;

  // =========================================
  // NAVBAR SCROLL BEHAVIOR
  // =========================================
  const navbar = document.querySelector('.navbar');
  const handleScroll = () => {
    if (window.scrollY > 60) {
      navbar?.classList.add('scrolled');
    } else {
      navbar?.classList.remove('scrolled');
    }
  };
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  // =========================================
  // HERO PARTICLES
  // =========================================
  const heroBg = document.querySelector('.hero-bg');
  if (heroBg) {
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div');
      p.className = 'hero-particle';
      const size = Math.random() * 4 + 2;
      p.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        left: ${Math.random() * 100}%;
        animation-duration: ${Math.random() * 10 + 8}s;
        animation-delay: ${Math.random() * 8}s;
        opacity: 0.4;
      `;
      heroBg.appendChild(p);
    }
  }

  // =========================================
  // HAMBURGER / MOBILE MENU
  // =========================================
  const hamburger = document.querySelector('.hamburger');
  const mobileMenu = document.querySelector('.mobile-menu');

  hamburger?.addEventListener('click', () => {
    isMobileMenuOpen = !isMobileMenuOpen;
    hamburger.classList.toggle('active', isMobileMenuOpen);
    mobileMenu?.classList.toggle('open', isMobileMenuOpen);
    document.body.style.overflow = isMobileMenuOpen ? 'hidden' : '';
  });

  mobileMenu?.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      isMobileMenuOpen = false;
      hamburger?.classList.remove('active');
      mobileMenu.classList.remove('open');
      document.body.style.overflow = '';
    });
  });

  // =========================================
  // SEARCH OVERLAY
  // =========================================
  const searchOverlay = document.querySelector('.search-overlay');
  const searchBtn = document.querySelector('.nav-search-btn');
  const searchClose = document.querySelector('.search-close');
  const searchInput = document.querySelector('.search-input');

  const openSearch = () => {
    isSearchOpen = true;
    searchOverlay?.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => searchInput?.focus(), 100);
  };

  const closeSearch = () => {
    isSearchOpen = false;
    searchOverlay?.classList.remove('open');
    document.body.style.overflow = '';
  };

  searchBtn?.addEventListener('click', openSearch);
  searchClose?.addEventListener('click', closeSearch);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isSearchOpen) closeSearch();
      if (isMobileMenuOpen) {
        isMobileMenuOpen = false;
        hamburger?.classList.remove('active');
        mobileMenu?.classList.remove('open');
        document.body.style.overflow = '';
      }
    }
  });

  // =========================================
  // CART DRAWER
  // =========================================
  const cartDrawer = document.querySelector('.cart-drawer');
  const cartOverlay = document.querySelector('.cart-overlay');
  const cartBtn = document.querySelector('.nav-cart-btn');
  const cartClose = document.querySelector('.cart-close');

  const openCart = () => {
    cartDrawer?.classList.add('open');
    cartOverlay?.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderCart();
  };

  const closeCart = () => {
    cartDrawer?.classList.remove('open');
    cartOverlay?.classList.remove('open');
    document.body.style.overflow = '';
  };

  cartBtn?.addEventListener('click', openCart);
  cartClose?.addEventListener('click', closeCart);
  cartOverlay?.addEventListener('click', closeCart);

  // =========================================
  // CART LOGIC
  // =========================================
  const saveCart = () => {
    localStorage.setItem('nordica-cart', JSON.stringify(cart));
  };

  const updateCartBadge = () => {
    const badge = document.querySelector('.cart-badge');
    const total = cart.reduce((sum, item) => sum + item.qty, 0);
    if (badge) {
      badge.textContent = total;
      badge.style.display = total > 0 ? 'flex' : 'none';
      badge.classList.remove('bounce');
      void badge.offsetWidth;
      badge.classList.add('bounce');
    }
  };

  const addToCart = (product) => {
    const existing = cart.find(i => i.id === product.id && (i.flavor || '') === (product.flavor || ''));
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ ...product, qty: 1 });
    }
    saveCart();
    updateCartBadge();
    showToast(product.name);
  };

  const removeFromCart = (id, flavor = '') => {
    cart = cart.filter(i => i.id !== id || (i.flavor || '') !== flavor);
    saveCart();
    updateCartBadge();
    renderCart();
  };

  const updateQty = (id, flavor, delta) => {
    const item = cart.find(i => i.id === id && (i.flavor || '') === flavor);
    if (item) {
      const cap = Number.isFinite(Number(item.stock)) && Number(item.stock) > 0 ? Math.min(99, Number(item.stock)) : 99;
      item.qty = Math.min(cap, Math.max(1, item.qty + delta));
      saveCart();
      updateCartBadge();
      renderCart();
    }
  };

  window.clearNordicaCart = () => {
    cart = [];
    saveCart();
    updateCartBadge();
    renderCart();
  };

  const renderCart = () => {
    const itemsEl = document.querySelector('.cart-items');
    const countEl = document.querySelector('.cart-drawer-count');
    const subtotalEl = document.querySelector('.cart-subtotal-price');
    const emptyEl = document.querySelector('.cart-empty');

    if (!itemsEl) return;

    const total = cart.reduce((sum, item) => sum + item.qty, 0);
    const subtotal = cart.reduce((sum, item) => sum + (parseFloat(item.price) * item.qty), 0);

    if (countEl) countEl.textContent = total + ' items';
    if (subtotalEl) subtotalEl.textContent = Math.round(subtotal).toLocaleString() + ' DT';

    // Localize shipping text in cart drawer
    const noteEl = document.querySelector('.cart-shipping-note');
    if (noteEl) {
      noteEl.innerHTML = `<span>Free shipping</span> on orders over 300 DT`;
    }

    // Remove existing items
    itemsEl.querySelectorAll('.cart-item').forEach(el => el.remove());

    if (cart.length === 0) {
      emptyEl?.style.setProperty('display', 'flex');
    } else {
      emptyEl?.style.setProperty('display', 'none');
      cart.forEach(item => {
        const el = document.createElement('div');
        el.className = 'cart-item';
        el.innerHTML = `
          <img src="${escapeHtml(safeImageUrl(item.img))}" alt="${escapeHtml(item.name)}" class="cart-item-img" onerror="this.src='assets/logo.png'">
          <div class="cart-item-info">
            <div class="cart-item-name">${escapeHtml(item.name)}</div>
            <div class="cart-item-cat">${escapeHtml(item.category)}${item.flavor ? ` • ${escapeHtml(item.flavor)}` : ''}</div>
            <div class="cart-item-bottom">
              <div class="cart-item-price">${Math.round(item.price * item.qty).toLocaleString()} DT</div>
              <div class="qty-control">
              <button class="qty-btn" data-action="dec" data-id="${escapeHtml(item.id)}" data-flavor="${escapeHtml(item.flavor || '')}">−</button>
              <span class="qty-num">${item.qty}</span>
              <button class="qty-btn" data-action="inc" data-id="${escapeHtml(item.id)}" data-flavor="${escapeHtml(item.flavor || '')}">+</button>
            </div>
              <button class="cart-item-remove" data-id="${escapeHtml(item.id)}" data-flavor="${escapeHtml(item.flavor || '')}" title="Remove">✕</button>
            </div>
          </div>
        `;
        itemsEl.insertBefore(el, emptyEl);
      });

      // Bind events
      itemsEl.querySelectorAll('.qty-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          updateQty(id, btn.dataset.flavor || '', btn.dataset.action === 'inc' ? 1 : -1);
        });
      });

      itemsEl.querySelectorAll('.cart-item-remove').forEach(btn => {
        btn.addEventListener('click', () => removeFromCart(btn.dataset.id, btn.dataset.flavor || ''));
      });
    }
  };

  // Checkout button event listener
  document.querySelector('.cart-checkout-btn')?.addEventListener('click', () => {
    if (cart.length === 0) {
      showToast("Your cart is empty!", "warning");
      return;
    }
    closeCart();
    window.location.href = 'checkout.html';
  });

  // =========================================
  // TOAST NOTIFICATION
  // =========================================
  const showToast = (productName, type = 'success') => {
    const container = document.querySelector('.toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-icon">${type === 'success' ? '✓' : '⚠'}</div>
      <div class="toast-message">
          <div class="toast-product">${escapeHtml(productName)}</div>
        ${type === 'success' ? 'Added to your cart!' : 'Please check your inputs.'}
      </div>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toast-out 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  };

  // =========================================
  // ADD TO CART BUTTONS (delegated)
  // =========================================
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-add-cart]');
    if (!btn || btn.dataset.adding === 'true') return;
    const id = btn.dataset.id;
    if (!id) return;

    btn.dataset.adding = 'true';
    const wasDisabled = btn.disabled;
    btn.disabled = true;
    try {
      const [products, packs] = await Promise.all([NordicaStore.get('products'), NordicaStore.get('packs')]);
      const item = products.find(p => p.id === id && p.active) || packs.find(p => p.id === id && p.active);
      if (!item) {
        showToast('This item is no longer available.', 'warning');
        return;
      }

      const isProduct = products.some(p => p.id === id);
      const flavor = btn.dataset.flavor || '';
      let flavors = item.flavors || [];
      if (typeof flavors === 'string') {
        try { flavors = JSON.parse(flavors); } catch { flavors = []; }
      }
      if (!Array.isArray(flavors)) flavors = [];
      if (isProduct && flavor && !flavors.includes(flavor)) {
        showToast('That flavor is no longer available.', 'warning');
        return;
      }
      const existing = cart.find(entry => entry.id === id && (entry.flavor || '') === flavor);
      if (isProduct && Number(item.stock) < (existing?.qty || 0) + 1) {
        showToast('There is not enough stock for another unit.', 'warning');
        return;
      }

      addToCart({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        img: item.image || btn.dataset.img || 'assets/logo.png',
        category: item.categoryName || 'Pack',
        flavor,
        stock: isProduct ? Number(item.stock) : undefined,
      });
    } catch (err) {
      showToast('Could not add this item. Please try again.', 'warning');
    } finally {
      btn.dataset.adding = 'false';
      btn.disabled = wasDisabled;
    }
  });

  // =========================================
  // INTERSECTION OBSERVER (Fade Up Animations)
  // =========================================
  const observeFadeUp = () => {
    const els = document.querySelectorAll('.fade-up');
    if (!els.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    els.forEach(el => observer.observe(el));
  };

  observeFadeUp();

  // =========================================
  // FILTER BUTTONS
  // =========================================
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.filters-bar');
      group?.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;
      const cards = document.querySelectorAll('.product-card[data-category]');

      cards.forEach(card => {
        const match = filter === 'all' || card.dataset.category === filter;
        card.style.display = match ? 'block' : 'none';
        if (match) {
          card.classList.remove('visible');
          setTimeout(() => card.classList.add('visible'), 50);
        }
      });
    });
  });

  // =========================================
  // ACTIVE NAV LINK
  // =========================================
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href && (href === currentPage || (currentPage === '' && href === 'index.html'))) {
      link.classList.add('active');
    }
  });

  // =========================================
  // SMOOTH NUMBER COUNTER (Hero Stats)
  // =========================================
  const animateCounters = () => {
    const counters = document.querySelectorAll('[data-count]');
    counters.forEach(el => {
      const target = parseInt(el.dataset.count);
      const suffix = el.dataset.suffix || '';
      let current = 0;
      const step = target / 60;
      const timer = setInterval(() => {
        current += step;
        if (current >= target) {
          current = target;
          clearInterval(timer);
        }
        el.textContent = Math.floor(current) + suffix;
      }, 16);
    });
  };

  // Trigger counters when hero is visible
  const heroStats = document.querySelector('.hero-stats');
  if (heroStats) {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounters();
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    counterObserver.observe(heroStats);
  }

  // =========================================
  // NEWSLETTER FORM
  // =========================================
  document.querySelector('.newsletter-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.querySelector('.newsletter-input');
    if (input?.value) {
      showToast('Newsletter subscription confirmed! 🎉');
      input.value = '';
    }
  });

  // =========================================
  // NAVBAR AUTH ACCOUNT BUTTON INJECTION
  // =========================================
  const updateNavbarAuth = () => {
    const navActions = document.querySelector('.nav-actions');
    if (!navActions) return;

    // Remove old button if exists to prevent duplicates
    document.getElementById('navAuthBtn')?.remove();

    const user = NordicaStore.getCurrentUser();
    const authLink = document.createElement('a');
    authLink.id = 'navAuthBtn';
    authLink.className = 'nav-search-btn';
    authLink.style.display = 'flex';
    authLink.style.alignItems = 'center';
    authLink.style.justifyContent = 'center';
    authLink.style.textDecoration = 'none';

    if (user) {
      authLink.href = 'profile.html';
      authLink.title = `Profile (${user.name})`;
      if (user.role === 'admin') {
        authLink.innerHTML = `<i class="fas fa-user-shield" style="color: var(--red);"></i>`;
      } else {
        authLink.innerHTML = `<i class="fas fa-user"></i>`;
      }
    } else {
      authLink.href = 'login.html';
      authLink.title = "Login / Register";
      authLink.innerHTML = `<i class="far fa-user"></i>`;
    }

    const hamburger = document.getElementById('hamburger') || document.querySelector('.hamburger');
    if (hamburger) {
      navActions.insertBefore(authLink, hamburger);
    } else {
      navActions.appendChild(authLink);
    }
  };

  // Run navbar account injection
  updateNavbarAuth();

  // =========================================
  // INIT
  // =========================================
  updateCartBadge();
  renderCart();
});
