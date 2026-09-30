const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  category    TEXT    NOT NULL DEFAULT 'Display',
  description TEXT    NOT NULL DEFAULT '',
  price       REAL    NOT NULL DEFAULT 0,
  stock       INTEGER NOT NULL DEFAULT 1,
  image_url   TEXT    NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reference      TEXT    NOT NULL UNIQUE,
  customer_name  TEXT    NOT NULL,
  email          TEXT    NOT NULL,
  phone          TEXT    NOT NULL,
  event_type     TEXT    NOT NULL DEFAULT '',
  notes          TEXT    NOT NULL DEFAULT '',
  pickup_date    TEXT    NOT NULL,
  return_date    TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'pending',
  total          REAL    NOT NULL DEFAULT 0,
  admin_notes    TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS booking_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  quantity    INTEGER NOT NULL DEFAULT 1,
  unit_price  REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(pickup_date, return_date);
CREATE INDEX IF NOT EXISTS idx_items_product ON booking_items(product_id);
`;

const SEED_PRODUCTS = [
  ['Gold Tiered Cake Stand', 'Cake Stand', 'Three-tier mirrored gold stand, perfect as the centrepiece of any dessert table.', 25, 1],
  ['Crystal Pedestal Cake Stand', 'Cake Stand', 'Elegant glass pedestal stand for wedding and celebration cakes.', 20, 1],
  ['Marble & Gold Serving Tray Set', 'Food Tray', 'Set of 3 marble-effect trays with gold handles for canapés and sweets.', 18, 1],
  ['Acrylic Cupcake Tower', 'Food Tray', 'Clear 5-tier tower holding up to 60 cupcakes.', 22, 1],
  ['Glass Drink Dispenser (8L)', 'Drink Dispenser', 'Glass barrel dispenser with gold stand and tap, ideal for lemonade or punch.', 15, 1],
  ['Double Drink Dispenser Station', 'Drink Dispenser', 'Two 5L dispensers on a matching gold rack.', 28, 1],
];

// Opens (and creates if needed) the database. Pass ':memory:' for tests.
function openDatabase(file) {
  const target = file || process.env.DB_FILE || path.join(__dirname, '..', 'data', 'luxe-display.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });

  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const { count } = db.prepare('SELECT COUNT(*) AS count FROM products').get();
  if (count === 0) {
    const insert = db.prepare('INSERT INTO products (name, category, description, price, stock) VALUES (?, ?, ?, ?, ?)');
    db.transaction(() => SEED_PRODUCTS.forEach((p) => insert.run(...p)))();
  }
  return db;
}

module.exports = { openDatabase };
