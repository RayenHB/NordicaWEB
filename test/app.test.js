const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { after, before, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const users = [{
  id: 'usr-admin-test', name: 'Test Admin', email: 'admin@test.local', phone: '+216 00 000 000', wilaya: 'Tunis',
  role: 'admin', active: true, orders: 0, totalSpent: '0.00', password: 'legacy-test-password',
}, {
  id: 'usr-customer-test', name: 'Test Customer', email: 'customer@test.local', phone: '+216 11 111 111', wilaya: 'Sousse',
  role: 'customer', active: true, orders: 0, totalSpent: '0.00', password: 'customer-test-password',
}];
const products = [{
  id: 'creatine-test', name: 'Test Creatine', categoryId: 'cat-1', categoryName: 'Creatine', price: '65.00', oldPrice: null,
  image: 'assets/products/creatine.png', badge: null, badgeType: null, rating: '5.0', reviews: 0, stock: 8,
  sku: 'INTERNAL-TEST-SKU', flavors: ['Unflavored'], description: 'Test item', details: [], featured: true, active: true,
}];
const packs = [{ id: 'pack-test', name: 'Test Pack', price: '40.00', active: true }];
const categories = [];
const deliveries = [];

function clone(row) {
  return row ? structuredClone(row) : row;
}

const fakeDatabase = {
  async initDB() {},
  async transaction(callback) {
    const productSnapshot = clone(products);
    const deliveryCount = deliveries.length;
    const userSnapshot = clone(users);
    try {
      return await callback({ query: (sql, params) => fakeDatabase.query(sql, params) });
    } catch (error) {
      products.splice(0, products.length, ...productSnapshot);
      deliveries.splice(deliveryCount);
      users.splice(0, users.length, ...userSnapshot);
      throw error;
    }
  },
  async query(sql, params = []) {
    const statement = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    let rows = [];

    if (statement.startsWith('select * from users where lower(email)')) {
      rows = users.filter(user => user.email.toLowerCase() === String(params[0]).toLowerCase());
    } else if (statement.startsWith('select id from users where lower(email)')) {
      rows = users.filter(user => user.email.toLowerCase() === String(params[0]).toLowerCase()).map(user => ({ id: user.id }));
    } else if (statement.startsWith('select * from users where id =')) {
      rows = users.filter(user => user.id === params[0]);
    } else if (statement.startsWith('select id, name, email, phone, wilaya, role, orders, totalspent, joinedat, active from users')) {
      rows = users.filter(user => user.role === 'customer').map(({ password, ...user }) => user);
    } else if (statement.startsWith('update users set password =')) {
      const user = users.find(entry => entry.id === params[1]);
      if (user) user.password = params[0];
    } else if (statement.startsWith('select * from users where phone =')) {
      rows = users.filter(user => user.phone === params[0]);
    } else if (statement.startsWith('select * from products order by name asc')) {
      rows = [...products];
    } else if (statement.startsWith('select id, name, price, stock, flavors from products where id =')) {
      rows = products.filter(product => product.id === params[0] && product.active).map(({ id, name, price, stock, flavors }) => ({ id, name, price, stock, flavors }));
    } else if (statement.startsWith('select id, name, price from packs where id =')) {
      rows = packs.filter(pack => pack.id === params[0] && pack.active).map(({ id, name, price }) => ({ id, name, price }));
    } else if (statement.startsWith('update products set stock = stock -')) {
      const product = products.find(entry => entry.id === params[1]);
      if (product) product.stock -= params[0];
    } else if (statement.startsWith('update products set stock=')) {
      const product = products.find(entry => entry.id === params[1]);
      if (product) {
        product.stock = params[0];
        rows = [product];
      }
    } else if (statement.startsWith('insert into categories')) {
      const [id, name, icon, image, description, slug] = params;
      const category = { id, name, icon, image, description, slug };
      categories.push(category);
      rows = [category];
    } else if (statement.startsWith('update categories set')) {
      const [name, image, description, slug, id] = params;
      const category = categories.find(entry => entry.id === id);
      if (category) Object.assign(category, { name, image, description, slug });
      rows = category ? [category] : [];
    } else if (statement.startsWith('insert into deliveries')) {
      const [id, orderId, userId, customer, phone, wilaya, address, productText, amount, status, method, trackingCode, notes] = params;
      const delivery = { id, orderId, userId, customer, phone, wilaya, address, products: productText, amount, status, method, trackingCode, notes, createdAt: '2026-10-06' };
      deliveries.push(delivery);
      rows = [delivery];
    } else if (statement.startsWith('select * from deliveries where userid =')) {
      rows = deliveries.filter(delivery => delivery.userId === params[0]);
    } else if (statement.startsWith('update users set orders = orders + 1')) {
      const user = users.find(entry => entry.id === params[1]);
      if (user) {
        user.orders += 1;
        user.totalSpent = String(Number(user.totalSpent) + Number(params[0]));
      }
    } else {
      throw new Error(`Unhandled test query: ${statement}`);
    }

    return { rows: rows.map(clone), rowCount: rows.length };
  },
};

const databasePath = require.resolve('../database');
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: fakeDatabase,
};
const { app } = require('../server');

let server;
let baseUrl;
let adminCookie;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

async function request(url, options = {}) {
  return fetch(`${baseUrl}${url}`, options);
}

test('public UI pages and local scripts are available and parse', async () => {
  const pages = ['/', '/products.html', '/packs.html', '/checkout.html', '/login.html', '/profile.html', '/admin/index.html'];
  for (const page of pages) {
    const response = await request(page);
    assert.equal(response.status, 200, `${page} should load`);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const html = await response.text();
    assert.match(html, /<html/i);
    for (const [, attributes, inlineScript] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/.test(attributes) || !inlineScript.trim()) continue;
      assert.doesNotThrow(() => new vm.Script(inlineScript, { filename: page }), `inline script in ${page} should parse`);
    }
  }

  for (const file of ['js/store.js', 'js/main.js', 'admin/js/admin.js']) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file }));
  }
  const adminHtml = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
  assert.doesNotMatch(adminHtml, /id="prod-stock-status-toggle"/, 'stock availability should follow the stock quantity field');
  assert.doesNotMatch(adminHtml, /name="(?:category-)?icon"/i, 'category creation should not request an icon');
  assert.equal((await request('/server.js')).status, 404, 'server source should not be public');
});

test('admin APIs reject unauthenticated requests and simulated Google sign-in is disabled', async () => {
  assert.equal((await request('/api/users')).status, 401);
  assert.equal((await request('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  const googleResponse = await request('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.local', googleId: 'fake' }) });
  assert.equal(googleResponse.status, 501);
});

test('login migrates a legacy password, issues a session, and never returns password data', async () => {
  const response = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ADMIN@test.local', password: 'legacy-test-password' }),
  });
  assert.equal(response.status, 200);
  const user = await response.json();
  assert.equal(user.role, 'admin');
  assert.equal(Object.hasOwn(user, 'password'), false);
  assert.match(users[0].password, /^scrypt\$/);
  adminCookie = response.headers.get('set-cookie').split(';')[0];
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);

  const listResponse = await request('/api/users', { headers: { Cookie: adminCookie } });
  assert.equal(listResponse.status, 200);
  assert.equal(Object.hasOwn((await listResponse.json())[0], 'password'), false);
});

test('category creation supplies the server default icon and category edits derive a slug', async () => {
  const created = await request('/api/categories', {
    method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'cat-test', name: 'Strength Mix', image: 'assets/logo.png', description: 'Test category' }),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).icon, 'fa-tags');

  const updated = await request('/api/categories/cat-test', {
    method: 'PUT', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Power Mix', image: 'assets/logo.png', description: 'Updated' }),
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).slug, 'power-mix');
});

test('image uploads use an extension that matches their validated image MIME type', async () => {
  const form = new FormData();
  form.append('image', new Blob(['test image data'], { type: 'image/png' }), 'untrusted.html');
  const response = await request('/api/upload', { method: 'POST', headers: { Cookie: adminCookie }, body: form });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.match(result.url, /^\/uploads\/.+\.png$/);
  fs.unlinkSync(path.join(root, result.url.slice(1)));
});

test('product API hides SKU and accepts stock-only updates', async () => {
  const list = await request('/api/products');
  assert.equal(list.status, 200);
  assert.equal(Object.hasOwn((await list.json())[0], 'sku'), false);

  const response = await request('/api/products/creatine-test', {
    method: 'PATCH', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stock: 0 }),
  });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.stock, 0);
  assert.equal(Object.hasOwn(updated, 'sku'), false);

  await request('/api/products/creatine-test', {
    method: 'PATCH', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stock: 8 }),
  });
});

test('checkout calculates current database prices and protects customer order history', async () => {
  const response = await request('/api/deliveries', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer: 'Guest Buyer', phone: '+216 22 222 222', wilaya: 'Tunis', address: '1 Test Street',
      amount: 0.01, items: [{ id: 'pack-test', qty: 2 }],
    }),
  });
  assert.equal(response.status, 201);
  const order = await response.json();
  assert.equal(Number(order.amount), 88);
  assert.equal(order.products, 'Test Pack (x2)');

  const productOrderResponse = await request('/api/deliveries', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer: 'Guest Buyer', phone: '+216 22 222 222', wilaya: 'Tunis', address: '1 Test Street',
      amount: 0.01, items: [{ id: 'creatine-test', qty: 2, flavor: 'Unflavored' }],
    }),
  });
  assert.equal(productOrderResponse.status, 201);
  assert.equal(Number((await productOrderResponse.json()).amount), 138);
  assert.equal(products[0].stock, 6);

  const rejectedOversell = await request('/api/deliveries', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer: 'Guest Buyer', phone: '+216 22 222 222', wilaya: 'Tunis', address: '1 Test Street',
      items: [{ id: 'creatine-test', qty: 7, flavor: 'Unflavored' }],
    }),
  });
  assert.equal(rejectedOversell.status, 400);
  assert.equal(products[0].stock, 6, 'failed transactions must restore stock');

  assert.equal((await request('/api/deliveries')).status, 401);
  assert.equal((await request('/api/my-deliveries')).status, 401);

  const customerLogin = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'customer@test.local', password: 'customer-test-password' }),
  });
  const customerCookie = customerLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/users', { headers: { Cookie: customerCookie } })).status, 403);

  const customerOrderResponse = await request('/api/deliveries', {
    method: 'POST', headers: { Cookie: customerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer: 'Test Customer', phone: '+216 11 111 111', wilaya: 'Sousse', address: '2 Test Street',
      items: [{ id: 'pack-test', qty: 1 }],
    }),
  });
  assert.equal(customerOrderResponse.status, 201);
  assert.equal((await customerOrderResponse.json()).userId, 'usr-customer-test');
  const history = await request('/api/my-deliveries', { headers: { Cookie: customerCookie } });
  assert.equal(history.status, 200);
  assert.equal((await history.json()).length, 1);
});
