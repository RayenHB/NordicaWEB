const { Client, Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

function hashSeedPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

const pgCredentials = {
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
};

const dbName = process.env.PGDATABASE || 'nordica_nutrition';

let pool;

async function initDB() {
  // 1. Ensure database exists
  const client = new Client({
    ...pgCredentials,
    database: 'postgres',
  });

  try {
    await client.connect();
    const res = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (res.rowCount === 0) {
      console.log(`Database "${dbName}" does not exist. Creating...`);
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Database "${dbName}" created successfully.`);
    }
  } catch (err) {
    console.error("Error creating database:", err.message);
  } finally {
    try {
      await client.end();
    } catch (e) {}
  }

  // 2. Main Connection Pool
  pool = new Pool({
    ...pgCredentials,
    database: dbName,
  });

  try {
    await pool.query('SELECT NOW()');
    console.log(`Successfully connected to PostgreSQL database: "${dbName}"`);
  } catch (err) {
    console.error("Error connecting main pool to PostgreSQL:", err.message);
    throw err;
  }

  // 3. Create Tables
  await createTables();

  // Normalize legacy emoji category icons without deleting customer or order data.
  await pool.query("UPDATE categories SET icon = 'fa-tags' WHERE icon !~ '^fa-[a-z0-9-]+$'");
  // Disable the old publicly documented admin credential and development fixture accounts in production.
  await pool.query("UPDATE users SET active = FALSE WHERE id = 'usr-admin' AND LOWER(email) = 'admin@nordicanutrition.tn'");
  if (process.env.NODE_ENV === 'production') {
    await pool.query("UPDATE users SET active = FALSE WHERE id IN ('usr-1', 'usr-2', 'usr-3', 'usr-4', 'usr-5') AND role = 'customer'");
  }

  // 4. Seed localized Tunisian data
  await seedDatabase();
}

async function createTables() {
  try {
    // Categories Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        icon VARCHAR(50) NOT NULL,
        image TEXT NOT NULL,
        description TEXT,
        slug VARCHAR(100) UNIQUE NOT NULL
      );
    `);

    // Products Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        categoryId VARCHAR(50) REFERENCES categories(id) ON DELETE SET NULL,
        categoryName VARCHAR(100) NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        oldPrice NUMERIC(10, 2),
        image TEXT NOT NULL,
        badge VARCHAR(50),
        badgeType VARCHAR(50),
        rating NUMERIC(2, 1) DEFAULT 5.0,
        reviews INTEGER DEFAULT 0,
        stock INTEGER DEFAULT 0,
        sku VARCHAR(100) UNIQUE NOT NULL,
        flavors JSON DEFAULT '[]'::json,
        description TEXT,
        details JSON DEFAULT '[]'::json,
        featured BOOLEAN DEFAULT FALSE,
        active BOOLEAN DEFAULT TRUE,
        createdAt DATE DEFAULT CURRENT_DATE
      );
    `);

    // Packs Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS packs (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        emoji VARCHAR(50) NOT NULL, -- Storing Font Awesome icon class name
        description TEXT,
        productNames JSON DEFAULT '[]'::json,
        price NUMERIC(10, 2) NOT NULL,
        originalPrice NUMERIC(10, 2) NOT NULL,
        savings NUMERIC(10, 2) NOT NULL,
        featured BOOLEAN DEFAULT FALSE,
        active BOOLEAN DEFAULT TRUE,
        createdAt DATE DEFAULT CURRENT_DATE
      );
    `);

    // Users Table (now with password and google_id fields)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        phone VARCHAR(50),
        wilaya VARCHAR(100), -- Governorate in Tunisian context
        role VARCHAR(50) DEFAULT 'customer',
        orders INTEGER DEFAULT 0,
        totalSpent NUMERIC(12, 2) DEFAULT 0,
        joinedAt DATE DEFAULT CURRENT_DATE,
        active BOOLEAN DEFAULT TRUE,
        password VARCHAR(255),
        googleId VARCHAR(255)
      );
    `);

    // Deliveries Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS deliveries (
        id VARCHAR(50) PRIMARY KEY,
        orderId VARCHAR(50) NOT NULL,
        userId VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
        customer VARCHAR(100) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        wilaya VARCHAR(100) NOT NULL,
        address TEXT NOT NULL,
        products TEXT NOT NULL,
        amount NUMERIC(12, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        method VARCHAR(50) DEFAULT 'home',
        trackingCode VARCHAR(100),
        createdAt DATE DEFAULT CURRENT_DATE,
        deliveredAt DATE,
        notes TEXT
      );
    `);

    await pool.query('ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS userId VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL');

    console.log("Database schema check: Tables verified/created.");
  } catch (err) {
    console.error("Error creating tables:", err.message);
    throw err;
  }
}

async function seedDatabase() {
  try {
    // 1. Seed categories (e.g. Font Awesome classes instead of emojis)
    const catCheck = await pool.query("SELECT COUNT(*) FROM categories");
    if (parseInt(catCheck.rows[0].count) === 0) {
      console.log("Seeding localized categories (Font Awesome)...");
      const categoriesSeed = [
        { id: 'cat-1', name: 'Protein', icon: 'fa-prescription-bottle', image: 'assets/products/whey_protein.png', description: 'High-quality protein supplements for muscle growth and recovery.', slug: 'protein' },
        { id: 'cat-2', name: 'Pre-Workout', icon: 'fa-bolt', image: 'assets/products/pre_workout.png', description: 'Explosive energy and focus formulas for peak performance.', slug: 'pre-workout' },
        { id: 'cat-3', name: 'Creatine', icon: 'fa-fire-alt', image: 'assets/products/creatine.png', description: 'Pure creatine monohydrate for strength and power output.', slug: 'creatine' },
        { id: 'cat-4', name: 'Amino Acids', icon: 'fa-flask', image: 'assets/products/bcaa.png', description: 'Essential and branched-chain amino acids for recovery.', slug: 'amino' },
        { id: 'cat-5', name: 'Mass Gainers', icon: 'fa-chart-line', image: 'assets/products/mass_gainer.png', description: 'High-calorie formulas designed for serious size and bulk.', slug: 'mass' },
        { id: 'cat-6', name: 'Vitamins', icon: 'fa-capsules', image: 'assets/products/multivitamin.png', description: 'Essential vitamins and minerals for overall health.', slug: 'vitamins' }
      ];

      for (const cat of categoriesSeed) {
        await pool.query(
          "INSERT INTO categories (id, name, icon, image, description, slug) VALUES ($1, $2, $3, $4, $5, $6)",
          [cat.id, cat.name, cat.icon, cat.image, cat.description, cat.slug]
        );
      }
    }

    // 2. Seed products (Tunisian pricing, etc.)
    const prodCheck = await pool.query("SELECT COUNT(*) FROM products");
    if (parseInt(prodCheck.rows[0].count) === 0) {
      console.log("Seeding products...");
      const productsSeed = [
        {
          id: 'whey-2kg', name: 'Nordica Whey Protein 2kg', categoryId: 'cat-1', categoryName: 'Protein',
          price: 159.00, oldPrice: 180.00, image: 'assets/products/whey_protein.png',
          badge: 'Best Seller', badgeType: 'hot',
          rating: 5.0, reviews: 128, stock: 45, sku: 'NW-WH-2KG',
          flavors: ['Chocolate', 'Vanilla', 'Strawberry', 'Banana'],
          description: 'Premium cold-processed whey protein concentrate with 24g of protein per serving. Fast-absorbing formula ideal for post-workout recovery. No added sugars, no fillers — just pure muscle fuel.',
          details: ['24g Protein per serving', '5.5g BCAAs naturally occurring', 'Low in fat and carbs', 'Easy to mix formula', '2kg / 60 servings'],
          featured: true, active: true, createdAt: '2026-01-10'
        },
        {
          id: 'preworkout', name: 'Nordica Pre-Workout Extreme', categoryId: 'cat-2', categoryName: 'Pre-Workout',
          price: 95.00, oldPrice: null, image: 'assets/products/pre_workout.png',
          badge: 'New', badgeType: 'new',
          rating: 4.5, reviews: 86, stock: 30, sku: 'NW-PW-300G',
          flavors: ['Watermelon', 'Blue Raspberry', 'Green Apple'],
          description: 'Explosive pre-workout formula with 200mg caffeine, beta-alanine, and citrulline malate. Engineered for maximum pumps, focus, and endurance during intense training sessions.',
          details: ['200mg Caffeine', '6g Citrulline Malate', '3.2g Beta-Alanine', 'No crash formula', '300g / 30 servings'],
          featured: true, active: true, createdAt: '2026-02-15'
        },
        {
          id: 'creatine', name: 'Nordica Creatine Monohydrate', categoryId: 'cat-3', categoryName: 'Creatine',
          price: 65.00, oldPrice: 85.00, image: 'assets/products/creatine.png',
          badge: 'Sale', badgeType: 'sale',
          rating: 5.0, reviews: 54, stock: 80, sku: 'NW-CR-500G',
          flavors: ['Unflavored'],
          description: 'Micronized creatine monohydrate — the most researched and proven supplement for strength gains, power output, and muscle volumization. 5g pure creatine per serving.',
          details: ['5g Pure Creatine per serving', 'Micronized for better absorption', 'Mixes instantly', 'Unflavored — stacks with anything', '500g / 100 servings'],
          featured: true, active: true, createdAt: '2026-01-20'
        },
        {
          id: 'bcaa', name: 'Nordica BCAA 2:1:1 Formula', categoryId: 'cat-4', categoryName: 'Amino Acids',
          price: 75.00, oldPrice: null, image: 'assets/products/bcaa.png',
          badge: null, badgeType: null,
          rating: 4.0, reviews: 42, stock: 55, sku: 'NW-BC-400G',
          flavors: ['Tropical Punch', 'Lemon Lime', 'Mixed Berry'],
          description: 'Essential branched-chain amino acids in the clinically studied 2:1:1 ratio. Reduces muscle soreness, promotes recovery, and prevents muscle breakdown during intense training.',
          details: ['7g BCAAs per serving (2:1:1)', '3.5g Leucine', '1.75g Isoleucine', '1.75g Valine', '400g / 40 servings'],
          featured: true, active: true, createdAt: '2026-03-05'
        },
        {
          id: 'mass-gainer', name: 'Nordica Mass Gainer 5kg', categoryId: 'cat-5', categoryName: 'Mass Gainers',
          price: 210.00, oldPrice: 240.00, image: 'assets/products/mass_gainer.png',
          badge: 'Sale', badgeType: 'sale',
          rating: 4.5, reviews: 33, stock: 20, sku: 'NW-MG-5KG',
          flavors: ['Chocolate', 'Vanilla'],
          description: 'High-calorie mass gainer with 1000+ kcal per serving, 50g of protein, and complex carbs. Ideal for hardgainers and athletes looking to pack on serious size and strength.',
          details: ['1050 Kcal per serving', '50g Protein', '200g Complex Carbs', 'Added Vitamins & Minerals', '5kg / 25 servings'],
          featured: false, active: true, createdAt: '2026-02-28'
        },
        {
          id: 'multivitamin', name: 'Nordica Multivitamin Complex', categoryId: 'cat-6', categoryName: 'Vitamins',
          price: 55.00, oldPrice: null, image: 'assets/products/multivitamin.png',
          badge: 'New', badgeType: 'new',
          rating: 4.5, reviews: 28, stock: 100, sku: 'NW-MV-90C',
          flavors: ['N/A'],
          description: 'Complete daily multivitamin formula with 23 essential vitamins and minerals. Supports immune function, energy metabolism, and overall health for active individuals.',
          details: ['23 Vitamins & Minerals', 'Includes Vitamin D3, B12, Zinc', 'Easy-to-swallow capsules', 'No artificial colors', '90 capsules / 3-month supply'],
          featured: false, active: true, createdAt: '2026-03-15'
        }
      ];

      for (const p of productsSeed) {
        await pool.query(
          `INSERT INTO products (id, name, categoryId, categoryName, price, oldPrice, image, badge, badgeType, rating, reviews, stock, sku, flavors, description, details, featured, active, createdAt) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [p.id, p.name, p.categoryId, p.categoryName, p.price, p.oldPrice, p.image, p.badge, p.badgeType, p.rating, p.reviews, p.stock, p.sku, JSON.stringify(p.flavors), p.description, JSON.stringify(p.details), p.featured, p.active, p.createdAt]
        );
      }
    }

    // 3. Seed packs (Font Awesome icons)
    const packCheck = await pool.query("SELECT COUNT(*) FROM packs");
    if (parseInt(packCheck.rows[0].count) === 0) {
      console.log("Seeding localized promotional packs...");
      const packsSeed = [
        {
          id: 'pack-starter', name: 'Starter Pack', emoji: 'fa-rocket',
          description: 'Perfect for beginners starting their fitness journey. Everything you need to kickstart your gains.',
          productNames: ['Whey Protein 1kg', 'Creatine Monohydrate', 'Multivitamin (60 caps)', 'Nutrition Guide PDF'],
          price: 199.00, originalPrice: 240.00, savings: 41.00, featured: false, active: true, createdAt: '2026-01-15'
        },
        {
          id: 'pack-performance', name: 'Performance Pack', emoji: 'fa-bolt',
          description: 'The complete toolkit for serious athletes. Maximum performance, maximum results.',
          productNames: ['Whey Protein 2kg', 'Pre-Workout Extreme', 'Creatine Monohydrate', 'BCAA 2:1:1 Formula', 'Shaker Bottle'],
          price: 320.00, originalPrice: 394.00, savings: 74.00, featured: true, active: true, createdAt: '2026-01-20'
        },
        {
          id: 'pack-bulk', name: 'Bulk Pack', emoji: 'fa-dumbbell',
          description: 'Built for mass. High-calorie nutrition stack designed to help you add serious size and strength.',
          productNames: ['Mass Gainer 5kg', 'Creatine Monohydrate', 'Multivitamin (90 caps)', 'ZMA Recovery Formula'],
          price: 290.00, originalPrice: 350.00, savings: 60.00, featured: false, active: true, createdAt: '2026-02-01'
        }
      ];

      for (const pk of packsSeed) {
        await pool.query(
          `INSERT INTO packs (id, name, emoji, description, productNames, price, originalPrice, savings, featured, active, createdAt) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [pk.id, pk.name, pk.emoji, pk.description, JSON.stringify(pk.productNames), pk.price, pk.originalPrice, pk.savings, pk.featured, pk.active, pk.createdAt]
        );
      }
    }

    // 4. Seed development customers. Production accounts must be configured explicitly.
    const userCheck = await pool.query("SELECT COUNT(*) FROM users");
    if (parseInt(userCheck.rows[0].count) === 0) {
      const usersSeed = [];
      if (process.env.NODE_ENV !== 'production') {
        usersSeed.push(
          { id: 'usr-1', name: 'Kais Ben Ali', email: 'kais.benali@email.tn', phone: '+216 98 123 456', wilaya: 'Tunis', role: 'customer', orders: 2, totalSpent: 294.00, joinedAt: '2026-01-12', active: true, password: 'password123' },
          { id: 'usr-2', name: 'Youssef Gharbi', email: 'youssef.g@email.tn', phone: '+216 55 234 567', wilaya: 'Jendouba', role: 'customer', orders: 4, totalSpent: 415.00, joinedAt: '2026-01-28', active: true, password: 'password123' },
          { id: 'usr-3', name: 'Amine Trabelsi', email: 'amine.t@email.tn', phone: '+216 22 345 678', wilaya: 'Sousse', role: 'customer', orders: 1, totalSpent: 95.00, joinedAt: '2026-02-10', active: true, password: 'password123' },
          { id: 'usr-4', name: 'Marwen Rezgui', email: 'marwen.r@email.tn', phone: '+216 97 456 789', wilaya: 'Sfax', role: 'customer', orders: 3, totalSpent: 310.00, joinedAt: '2026-02-20', active: false, password: 'password123' },
          { id: 'usr-5', name: 'Sonia Dridi', email: 'sonia.d@email.tn', phone: '+216 50 567 890', wilaya: 'Bizerte', role: 'customer', orders: 1, totalSpent: 199.00, joinedAt: '2026-03-05', active: true, password: 'password123' }
        );
      }

      const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (adminEmail && adminPassword) {
        usersSeed.push({ id: 'usr-admin', name: 'Admin User', email: adminEmail, phone: null, wilaya: null, role: 'admin', orders: 0, totalSpent: 0, joinedAt: '2026-01-01', active: true, password: adminPassword });
      } else {
        console.log('Skipping admin seed; set ADMIN_EMAIL and ADMIN_PASSWORD to create one during initialization.');
      }

      for (const u of usersSeed) {
        await pool.query(
          `INSERT INTO users (id, name, email, phone, wilaya, role, orders, totalSpent, joinedAt, active, password) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [u.id, u.name, u.email, u.phone, u.wilaya, u.role, u.orders, u.totalSpent, u.joinedAt, u.active, hashSeedPassword(u.password)]
        );
      }
    }

    // 5. Seed sample orders outside production.
    const delCheck = await pool.query("SELECT COUNT(*) FROM deliveries");
    if (process.env.NODE_ENV !== 'production' && parseInt(delCheck.rows[0].count) === 0) {
      console.log("Seeding localized deliveries...");
      const deliveriesSeed = [
        { id: 'DEL-001', orderId: 'ORD-001', customer: 'Kais Ben Ali', phone: '+216 98 123 456', wilaya: 'Tunis', address: 'Avenue Habib Bourguiba, Tunis', products: 'Nordica Whey Protein 2kg + Starter Pack', amount: 358.00, status: 'delivered', method: 'home', trackingCode: 'TN-DEL-1001', createdAt: '2026-04-01', deliveredAt: '2026-04-04', notes: '' },
        { id: 'DEL-002', orderId: 'ORD-002', customer: 'Youssef Gharbi', phone: '+216 55 234 567', wilaya: 'Jendouba', address: 'Route de Tabarka, Jendouba', products: 'Starter Pack', amount: 199.00, status: 'in-transit', method: 'home', trackingCode: 'TN-DEL-1002', createdAt: '2026-04-05', deliveredAt: null, notes: 'Deliver after 4pm' },
        { id: 'DEL-003', orderId: 'ORD-003', customer: 'Amine Trabelsi', phone: '+216 22 345 678', wilaya: 'Sousse', address: 'Khezama Est, Sousse', products: 'Creatine x2', amount: 130.00, status: 'pending', method: 'relay', trackingCode: 'TN-DEL-1003', createdAt: '2026-04-06', deliveredAt: null, notes: '' },
        { id: 'DEL-004', orderId: 'ORD-004', customer: 'Sonia Dridi', phone: '+216 50 567 890', wilaya: 'Bizerte', address: 'Corniche, Bizerte', products: 'Bulk Pack', amount: 290.00, status: 'pending', method: 'home', trackingCode: 'TN-DEL-1004', createdAt: '2026-04-07', deliveredAt: null, notes: 'Call client before arrival' }
      ];

      for (const d of deliveriesSeed) {
        await pool.query(
          `INSERT INTO deliveries (id, orderId, customer, phone, wilaya, address, products, amount, status, method, trackingCode, createdAt, deliveredAt, notes) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [d.id, d.orderId, d.customer, d.phone, d.wilaya, d.address, d.products, d.amount, d.status, d.method, d.trackingCode, d.createdAt, d.deliveredAt, d.notes]
        );
      }
    }

    console.log("Database localized seeding finished.");
  } catch (err) {
    console.error("Error seeding database:", err.message);
  }
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = {
      query: async (text, params) => {
        const result = await client.query(text, params);
        if (result.rows) result.rows = keysToCamelCase(result.rows);
        return result;
      },
    };
    const result = await callback(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const camelCaseMap = {
  categoryid: 'categoryId',
  categoryname: 'categoryName',
  oldprice: 'oldPrice',
  badgetype: 'badgeType',
  createdat: 'createdAt',
  productnames: 'productNames',
  originalprice: 'originalPrice',
  googleid: 'googleId',
  joinedat: 'joinedAt',
  totalspent: 'totalSpent',
  userid: 'userId',
  orderid: 'orderId',
  trackingcode: 'trackingCode',
  deliveredat: 'deliveredAt'
};

function keysToCamelCase(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(keysToCamelCase);
  
  const newObj = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const camelKey = camelCaseMap[key] || key;
      newObj[camelKey] = obj[key];
    }
  }
  return newObj;
}

module.exports = {
  initDB,
  transaction,
  query: async (text, params) => {
    const res = await pool.query(text, params);
    if (res.rows) {
      res.rows = keysToCamelCase(res.rows);
    }
    return res;
  },
  pool
};
