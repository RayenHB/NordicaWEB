const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./database');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_COOKIE = 'nordica_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const scrypt = promisify(crypto.scrypt);

// The storefront and API are same-origin. Keep request bodies bounded.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// Multer Disk Storage Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, and WebP images are allowed.'));
  },
});

// Serve only public assets and pages. Do not expose source files or configuration.
app.use('/uploads', express.static(uploadDir));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
const publicPages = new Set([
  'index.html', 'products.html', 'packs.html', 'checkout.html',
  'login.html', 'profile.html',
]);
app.get(['/', '/index.html', '/products.html', '/packs.html', '/checkout.html', '/login.html', '/profile.html'], (req, res) => {
  const page = req.path === '/' ? 'index.html' : path.basename(req.path);
  if (!publicPages.has(page)) return res.sendStatus(404);
  res.sendFile(path.join(__dirname, page));
});

function hashSessionUserId(userId) {
  const payload = Buffer.from(JSON.stringify({ id: userId, exp: Date.now() + SESSION_TTL_SECONDS * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function getSessionUserId(req) {
  const cookieHeader = req.headers.cookie || '';
  const token = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest();
  let received;
  try {
    received = Buffer.from(signature, 'base64url');
  } catch (err) {
    return null;
  }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.exp > Date.now() ? session.id : null;
  } catch (err) {
    return null;
  }
}

function setSessionCookie(req, res, userId) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${SESSION_COOKIE}=${hashSessionUserId(userId)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

function clearSessionCookie(req, res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure}`);
}

async function loadSessionUser(req) {
  const userId = getSessionUserId(req);
  if (!userId) return null;
  const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = result.rows[0];
  return user && user.active ? user : null;
}

async function optionalAuth(req, res, next) {
  try {
    req.authUser = await loadSessionUser(req);
    next();
  } catch (err) {
    res.status(500).json({ error: 'Unable to verify the current session.' });
  }
}

async function requireAuth(req, res, next) {
  try {
    req.authUser = await loadSessionUser(req);
    if (!req.authUser) return res.status(401).json({ error: 'Please sign in to continue.' });
    next();
  } catch (err) {
    res.status(500).json({ error: 'Unable to verify the current session.' });
  }
}

async function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.authUser.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
    next();
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(password, storedPassword) {
  if (typeof password !== 'string' || typeof storedPassword !== 'string') return false;
  if (storedPassword.startsWith('scrypt$')) {
    const [, salt, storedHash] = storedPassword.split('$');
    if (!salt || !storedHash) return false;
    const derived = await scrypt(password, salt, 64);
    const expected = Buffer.from(storedHash, 'hex');
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
  }
  const expected = crypto.createHash('sha256').update(storedPassword).digest();
  const actual = crypto.createHash('sha256').update(password).digest();
  return crypto.timingSafeEqual(expected, actual);
}

function withoutPassword(user) {
  if (!user) return user;
  const { password, ...safeUser } = user;
  return safeUser;
}

function withoutSku(product) {
  if (!product) return product;
  const { sku, ...publicProduct } = product;
  return publicProduct;
}

function slugify(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// =========================================================
// API ENDPOINT: FILE UPLOAD
// =========================================================
app.post('/api/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image file provided." });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// =========================================================
// API ENDPOINTS: AUTHENTICATION
// =========================================================
app.post('/api/auth/register', async (req, res) => {
  const { name, phone, wilaya, password } = req.body;
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedName || normalizedName.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Enter a valid name, email, and password of at least 6 characters.' });
  }
  const id = `usr-${crypto.randomUUID()}`;
  try {
    const checkUser = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (checkUser.rowCount > 0) {
      return res.status(400).json({ error: "Email already registered." });
    }

    const result = await db.query(
      `INSERT INTO users (id, name, email, phone, wilaya, role, password, active) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, email, phone, wilaya, role, active`,
      [id, normalizedName, email, phone || null, wilaya || null, 'customer', await hashPassword(password), true]
    );
    setSessionCookie(req, res, result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered.' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const { password } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (result.rowCount === 0) {
      return res.status(400).json({ error: "Invalid email or password." });
    }
    const user = result.rows[0];
    if (!user.active || !(await verifyPassword(password, user.password))) {
      return res.status(400).json({ error: "Invalid email or password." });
    }
    if (!user.password.startsWith('scrypt$')) {
      await db.query('UPDATE users SET password = $1 WHERE id = $2', [await hashPassword(password), user.id]);
    }
    setSessionCookie(req, res, user.id);
    res.json(withoutPassword(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/google', (req, res) => {
  res.status(501).json({ error: 'Google sign-in is not configured.' });
});

app.get('/api/auth/session', requireAuth, (req, res) => {
  res.json(withoutPassword(req.authUser));
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ success: true });
});

// =========================================================
// API ENDPOINTS: CATEGORIES
// =========================================================
app.get('/api/categories', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM categories ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/categories', requireAdmin, async (req, res) => {
  const { id, name, image, description, slug } = req.body;
  const categorySlug = slugify(slug || name);
  if (!id || !name || !image || !categorySlug) return res.status(400).json({ error: 'Category id, name, and image are required.' });
  try {
    const result = await db.query(
      'INSERT INTO categories (id, name, icon, image, description, slug) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [id, name, 'fa-tags', image, description || null, categorySlug]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A category with that id or slug already exists.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/categories/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, image, description, slug } = req.body;
  const categorySlug = slugify(slug || name);
  if (!name || !image || !categorySlug) return res.status(400).json({ error: 'Category name and image are required.' });
  try {
    const result = await db.query(
      'UPDATE categories SET name=$1, image=$2, description=$3, slug=$4 WHERE id=$5 RETURNING *',
      [name, image, description || null, categorySlug, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Category not found." });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A category with that slug already exists.' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM categories WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================
// API ENDPOINTS: PRODUCTS
// =========================================================
app.get('/api/products', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM products ORDER BY name ASC');
    res.json(result.rows.map(withoutSku));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', requireAdmin, async (req, res) => {
  const { id, name, categoryId, categoryName, price, oldPrice, image, badge, badgeType, rating, reviews, stock, flavors, description, details, featured, active } = req.body;
  if (!id || !name || !categoryId || !categoryName || !image || !Number.isFinite(Number(price)) || Number(price) < 0 || !Number.isInteger(Number(stock)) || Number(stock) < 0) {
    return res.status(400).json({ error: 'Product id, name, category, image, price, and valid stock are required.' });
  }
  try {
    const result = await db.query(
      `INSERT INTO products (id, name, categoryId, categoryName, price, oldPrice, image, badge, badgeType, rating, reviews, stock, sku, flavors, description, details, featured, active) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
      [id, name, categoryId, categoryName, price, oldPrice, image, badge, badgeType, rating || 5.0, reviews || 0, stock || 0, id, JSON.stringify(flavors || []), description, JSON.stringify(details || []), featured || false, active !== false]
    );
    res.status(201).json(withoutSku(result.rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A product with that id already exists.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, categoryId, categoryName, price, oldPrice, image, badge, badgeType, stock, flavors, description, details, active } = req.body;
  if (!name || !categoryId || !categoryName || !image || !Number.isFinite(Number(price)) || Number(price) < 0 || !Number.isInteger(Number(stock)) || Number(stock) < 0) {
    return res.status(400).json({ error: 'Product name, category, image, price, and valid stock are required.' });
  }
  try {
    const result = await db.query(
      `UPDATE products 
       SET name=$1, categoryId=$2, categoryName=$3, price=$4, oldPrice=$5, image=$6, badge=$7, badgeType=$8, stock=$9, flavors=$10, description=$11, details=$12, active=$13 
       WHERE id=$14 RETURNING *`,
      [name, categoryId, categoryName, price, oldPrice, image, badge, badgeType, stock, JSON.stringify(flavors || []), description, JSON.stringify(details || []), active, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Product not found." });
    res.json(withoutSku(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/products/:id', requireAdmin, async (req, res) => {
  const { stock } = req.body;
  const numericStock = Number(stock);
  if (!Number.isInteger(numericStock) || numericStock < 0) return res.status(400).json({ error: 'Stock must be a non-negative whole number.' });
  try {
    const result = await db.query('UPDATE products SET stock=$1 WHERE id=$2 RETURNING *', [numericStock, req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Product not found.' });
    res.json(withoutSku(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM products WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================
// API ENDPOINTS: BUNDLE PROMOPACKS
// =========================================================
app.get('/api/packs', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM packs ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/packs', requireAdmin, async (req, res) => {
  const { id, name, emoji, description, productNames, price, originalPrice, savings, featured, active } = req.body;
  if (!id || !name || !emoji || !Number.isFinite(Number(price)) || !Number.isFinite(Number(originalPrice)) || Number(price) < 0 || Number(originalPrice) < Number(price)) {
    return res.status(400).json({ error: 'Pack id, name, icon, and valid prices are required.' });
  }
  try {
    const result = await db.query(
      `INSERT INTO packs (id, name, emoji, description, productNames, price, originalPrice, savings, featured, active) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, name, emoji, description, JSON.stringify(productNames || []), price, originalPrice, savings, featured || false, active !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A pack with that id already exists.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/packs/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, emoji, description, productNames, price, originalPrice, savings, active } = req.body;
  if (!name || !emoji || !Number.isFinite(Number(price)) || !Number.isFinite(Number(originalPrice)) || Number(price) < 0 || Number(originalPrice) < Number(price)) {
    return res.status(400).json({ error: 'Pack name, icon, and valid prices are required.' });
  }
  try {
    const result = await db.query(
      `UPDATE packs 
       SET name=$1, emoji=$2, description=$3, productNames=$4, price=$5, originalPrice=$6, savings=$7, active=$8 
       WHERE id=$9 RETURNING *`,
      [name, emoji, description, JSON.stringify(productNames || []), price, originalPrice, savings, active, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Pack not found." });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/packs/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM packs WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================
// API ENDPOINTS: REGISTERED USERS
// =========================================================
app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const result = await db.query("SELECT id, name, email, phone, wilaya, role, orders, totalSpent, joinedAt, active FROM users WHERE role = 'customer' ORDER BY name ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { id, name, email, phone, wilaya, orders, totalSpent, active, password } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!id || !name || !/^\S+@\S+\.\S+$/.test(normalizedEmail) || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Customer id, name, valid email, and password of at least 6 characters are required.' });
  }
  try {
    const result = await db.query(
      `INSERT INTO users (id, name, email, phone, wilaya, role, orders, totalSpent, active, password) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, name, email, phone, wilaya, role, orders, totalSpent, joinedAt, active`,
      [id, name.trim(), normalizedEmail, phone || null, wilaya || null, 'customer', orders || 0, totalSpent || 0, active !== false, await hashPassword(password)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A customer with that id or email already exists.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, wilaya, orders, totalSpent, active, password } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!name || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) return res.status(400).json({ error: 'Customer name and valid email are required.' });
  if (password && password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    const result = await db.query(
      `UPDATE users 
       SET name=$1, email=$2, phone=$3, wilaya=$4, orders=$5, totalSpent=$6, active=$7, password=COALESCE($8, password) 
       WHERE id=$9 AND role='customer' RETURNING id, name, email, phone, wilaya, role, orders, totalSpent, joinedAt, active`,
      [name.trim(), normalizedEmail, phone || null, wilaya || null, orders, totalSpent, active, password ? await hashPassword(password) : null, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Customer not found." });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A customer with that email already exists.' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query("DELETE FROM users WHERE id = $1 AND role = 'customer' RETURNING id", [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Customer not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================
// API ENDPOINTS: DELIVERIES
// =========================================================
app.get('/api/deliveries', requireAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM deliveries ORDER BY createdAt DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/my-deliveries', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM deliveries WHERE userId = $1 ORDER BY createdAt DESC', [req.authUser.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/deliveries', optionalAuth, async (req, res) => {
  const { customer, phone, wilaya, address, notes } = req.body;
  if (!customer || !phone || !wilaya || !address) {
    return res.status(400).json({ error: 'Name, phone, governorate, and address are required.' });
  }

  let productDescription;
  let amount;
  let status;
  let method;
  let trackingCode;
  let orderId;
  let itemsToPrice = null;

  if (req.authUser?.role === 'admin' && !Array.isArray(req.body.items)) {
    productDescription = req.body.products;
    amount = Number(req.body.amount);
    status = req.body.status || 'pending';
    method = req.body.method || 'home';
    trackingCode = req.body.trackingCode || '';
    orderId = req.body.orderId || `ORD-${crypto.randomUUID()}`;
    if (!productDescription || !Number.isFinite(amount) || amount < 0 || !['pending', 'in-transit', 'delivered', 'cancelled'].includes(status) || !['home', 'relay'].includes(method)) {
      return res.status(400).json({ error: 'Products and a valid amount are required.' });
    }
  } else {
    const items = req.body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 40) {
      return res.status(400).json({ error: 'Your cart is empty or contains too many items.' });
    }
    itemsToPrice = items.map(item => ({
      id: typeof item.id === 'string' ? item.id : '',
      qty: Number(item.qty),
      flavor: typeof item.flavor === 'string' ? item.flavor.trim() : '',
    }));
    if (itemsToPrice.some(item => !item.id || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99)) {
      return res.status(400).json({ error: 'The cart contains an invalid item or quantity.' });
    }
    status = 'pending';
    method = 'home';
    trackingCode = '';
    orderId = `ORD-${crypto.randomUUID()}`;
  }

  const deliveryId = `DEL-${crypto.randomUUID()}`;
  const linkedUserId = req.authUser && req.authUser.role !== 'admin' ? req.authUser.id : null;
  try {
    const delivery = await db.transaction(async tx => {
      if (itemsToPrice) {
        let subtotal = 0;
        const descriptions = [];
        for (const item of itemsToPrice) {
          const productResult = await tx.query(
            'SELECT id, name, price, stock, flavors FROM products WHERE id = $1 AND active = TRUE FOR UPDATE',
            [item.id]
          );
          if (productResult.rowCount > 0) {
            const product = productResult.rows[0];
            if (Number(product.stock) < item.qty) throw Object.assign(new Error(`${product.name} does not have enough stock.`), { statusCode: 400 });
            const availableFlavors = typeof product.flavors === 'string' ? JSON.parse(product.flavors) : (product.flavors || []);
            if (item.flavor && !availableFlavors.includes(item.flavor)) throw Object.assign(new Error(`${product.name} does not offer that flavor.`), { statusCode: 400 });
            await tx.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.qty, item.id]);
            subtotal += Number(product.price) * item.qty;
            descriptions.push(`${product.name}${item.flavor ? ` - ${item.flavor}` : ''} (x${item.qty})`);
            continue;
          }

          const packResult = await tx.query('SELECT id, name, price FROM packs WHERE id = $1 AND active = TRUE FOR SHARE', [item.id]);
          if (packResult.rowCount === 0) throw Object.assign(new Error('A cart item is no longer available.'), { statusCode: 400 });
          const pack = packResult.rows[0];
          subtotal += Number(pack.price) * item.qty;
          descriptions.push(`${pack.name} (x${item.qty})`);
        }
        amount = subtotal + (subtotal > 300 ? 0 : 8);
        productDescription = descriptions.join(', ');
      }

      const result = await tx.query(
        `INSERT INTO deliveries (id, orderId, userId, customer, phone, wilaya, address, products, amount, status, method, trackingCode, notes) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [deliveryId, orderId, linkedUserId, customer.trim(), phone.trim(), wilaya, address.trim(), productDescription, amount, status, method, trackingCode, notes || '']
      );
      if (linkedUserId) await tx.query('UPDATE users SET orders = orders + 1, totalSpent = totalSpent + $1 WHERE id = $2', [amount, linkedUserId]);
      return result.rows[0];
    });

    res.status(201).json(delivery);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/deliveries/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { customer, phone, wilaya, address, products, amount, method, trackingCode, status, notes, deliveredAt } = req.body;
  if (!customer || !phone || !wilaya || !address || !products || !Number.isFinite(Number(amount)) || Number(amount) < 0 || !['pending', 'in-transit', 'delivered', 'cancelled'].includes(status) || !['home', 'relay'].includes(method)) {
    return res.status(400).json({ error: 'Delivery details, valid amount, status, and method are required.' });
  }
  try {
    const result = await db.query(
      `UPDATE deliveries 
       SET customer=$1, phone=$2, wilaya=$3, address=$4, products=$5, amount=$6, method=$7, trackingCode=$8, status=$9, notes=$10, deliveredAt=$11 
       WHERE id=$12 RETURNING *`,
      [customer, phone, wilaya, address, products, amount, method, trackingCode, status, notes, deliveredAt || null, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Delivery shipment not found." });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/deliveries/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM deliveries WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError || err.status === 413) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller.' : err.message });
  }
  if (req.path.startsWith('/api/')) return res.status(400).json({ error: err.message || 'Invalid request.' });
  res.status(500).send('Internal server error.');
});

// =========================================================
// SERVER STARTUP
// =========================================================
async function startServer() {
  await db.initDB();
  return app.listen(PORT, () => {
    console.log('========================================================');
    console.log('Nordica Nutrition Server is active!');
    console.log(`Running on: http://localhost:${PORT}`);
    console.log('========================================================');
  });
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('Critical: Could not initialize database connection.', err.message);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };
