const crypto = require('crypto');

const STATUSES = ['pending', 'confirmed', 'picked_up', 'returned', 'cancelled'];
// Every status except "cancelled" keeps the items reserved for those dates.
const RELEASING_STATUSES = ['cancelled'];
const MAX_RENTAL_DAYS = 30;
const MAX_ADVANCE_DAYS = 730;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toUTC(value) {
  return new Date(`${value}T00:00:00Z`).getTime();
}

function fromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(value, n) {
  return fromUTC(toUTC(value) + n * DAY_MS);
}

function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

// Today's date in the server's local timezone (set TZ to control it).
function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function eachDay(from, to) {
  const days = [];
  for (let t = toUTC(from); t <= toUTC(to); t += DAY_MS) days.push(fromUTC(t));
  return days;
}

class BookingError extends Error {
  constructor(message, status = 400, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function createBookingService(db) {
  const placeholders = RELEASING_STATUSES.map(() => '?').join(',');

  const reservedStmt = db.prepare(`
    SELECT b.pickup_date, b.return_date, bi.quantity
    FROM booking_items bi
    JOIN bookings b ON b.id = bi.booking_id
    WHERE bi.product_id = ?
      AND b.status NOT IN (${placeholders})
      AND b.pickup_date <= ?
      AND b.return_date >= ?
  `);

  // Map of date -> quantity already reserved for a product between from and to (inclusive).
  function reservedByDay(productId, from, to, excludeBookingId) {
    const rows = excludeBookingId
      ? db.prepare(`
          SELECT b.pickup_date, b.return_date, bi.quantity
          FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id
          WHERE bi.product_id = ? AND b.status NOT IN (${placeholders})
            AND b.pickup_date <= ? AND b.return_date >= ? AND b.id != ?
        `).all(productId, ...RELEASING_STATUSES, to, from, excludeBookingId)
      : reservedStmt.all(productId, ...RELEASING_STATUSES, to, from);

    const map = {};
    for (const row of rows) {
      const start = row.pickup_date > from ? row.pickup_date : from;
      const end = row.return_date < to ? row.return_date : to;
      for (const day of eachDay(start, end)) map[day] = (map[day] || 0) + row.quantity;
    }
    return map;
  }

  function getProduct(id) {
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  }

  function listProducts({ includeInactive = false } = {}) {
    const sql = includeInactive
      ? 'SELECT * FROM products ORDER BY active DESC, category, name'
      : 'SELECT * FROM products WHERE active = 1 ORDER BY category, name';
    return db.prepare(sql).all();
  }

  // Availability calendar used by the booking page.
  function availability(productId, from, to) {
    const product = getProduct(productId);
    if (!product || !product.active) throw new BookingError('Item not found', 404);
    const reserved = reservedByDay(product.id, from, to);
    return { productId: product.id, stock: product.stock, reserved };
  }

  function checkItems(items, pickup, ret, excludeBookingId) {
    const conflicts = [];
    for (const item of items) {
      const reserved = reservedByDay(item.product.id, pickup, ret, excludeBookingId);
      const clashing = eachDay(pickup, ret).filter(
        (day) => (reserved[day] || 0) + item.quantity > item.product.stock
      );
      if (clashing.length) conflicts.push({ productId: item.product.id, name: item.product.name, dates: clashing });
    }
    return conflicts;
  }

  function validateDates(pickup, ret) {
    if (!isValidDate(pickup)) throw new BookingError('Please choose a valid pick-up date.');
    if (!isValidDate(ret)) throw new BookingError('Please choose a valid drop-off date.');
    if (pickup < today()) throw new BookingError('The pick-up date cannot be in the past.');
    if (ret < pickup) throw new BookingError('The drop-off date must be on or after the pick-up date.');
    if (daysBetween(pickup, ret) + 1 > MAX_RENTAL_DAYS)
      throw new BookingError(`Rentals can last at most ${MAX_RENTAL_DAYS} days.`);
    if (daysBetween(today(), pickup) > MAX_ADVANCE_DAYS)
      throw new BookingError('That date is too far in the future to book online.');
  }

  function normaliseItems(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0)
      throw new BookingError('Please choose at least one item to rent.');
    const merged = new Map();
    for (const raw of rawItems) {
      const productId = Number(raw && raw.productId);
      const quantity = Number(raw && raw.quantity);
      if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 50)
        throw new BookingError('One of the selected items is invalid.');
      merged.set(productId, (merged.get(productId) || 0) + quantity);
    }
    return [...merged].map(([productId, quantity]) => {
      const product = getProduct(productId);
      if (!product || !product.active) throw new BookingError('One of the selected items is no longer available.');
      if (quantity > product.stock)
        throw new BookingError(`We only have ${product.stock} × ${product.name}.`);
      return { product, quantity };
    });
  }

  function clean(value, max, required, label) {
    const str = typeof value === 'string' ? value.trim() : '';
    if (required && !str) throw new BookingError(`Please enter your ${label}.`);
    return str.slice(0, max);
  }

  function newReference() {
    return `LD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  }

  const insertBooking = db.prepare(`
    INSERT INTO bookings (reference, customer_name, email, phone, event_type, notes, pickup_date, return_date, total)
    VALUES (@reference, @customer_name, @email, @phone, @event_type, @notes, @pickup_date, @return_date, @total)
  `);
  const insertItem = db.prepare(
    'INSERT INTO booking_items (booking_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)'
  );

  // The availability check and the insert run in one IMMEDIATE transaction, which takes
  // SQLite's write lock up front. Two customers submitting the same dates at the same
  // moment are therefore serialised: the second one sees the first booking and is refused.
  const createTx = db.transaction((input) => {
    const conflicts = checkItems(input.items, input.pickup_date, input.return_date);
    if (conflicts.length) {
      throw new BookingError(
        'Sorry, some items are already booked on the dates you chose.',
        409,
        conflicts
      );
    }
    let reference;
    do reference = newReference();
    while (db.prepare('SELECT 1 FROM bookings WHERE reference = ?').get(reference));

    const total = input.items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
    const { lastInsertRowid } = insertBooking.run({ ...input.fields, reference, total,
      pickup_date: input.pickup_date, return_date: input.return_date });
    for (const i of input.items) insertItem.run(lastInsertRowid, i.product.id, i.quantity, i.product.price);
    return getBooking(lastInsertRowid);
  });

  function createBooking(body) {
    const fields = {
      customer_name: clean(body.name, 120, true, 'name'),
      email: clean(body.email, 200, true, 'email address'),
      phone: clean(body.phone, 40, true, 'phone number'),
      event_type: clean(body.eventType, 80, false),
      notes: clean(body.notes, 1000, false),
    };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))
      throw new BookingError('Please enter a valid email address.');

    const pickup_date = body.pickupDate;
    const return_date = body.returnDate;
    validateDates(pickup_date, return_date);
    const items = normaliseItems(body.items);
    return createTx.immediate({ fields, items, pickup_date, return_date });
  }

  function getBooking(id) {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) return null;
    booking.items = db.prepare(`
      SELECT bi.product_id, bi.quantity, bi.unit_price, p.name, p.category
      FROM booking_items bi JOIN products p ON p.id = bi.product_id
      WHERE bi.booking_id = ?
    `).all(id);
    return booking;
  }

  function listBookings({ status, q, from, to } = {}) {
    const where = [];
    const params = [];
    if (status && STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
    if (q) {
      where.push('(reference LIKE ? OR customer_name LIKE ? OR email LIKE ? OR phone LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    if (from && isValidDate(from)) { where.push('return_date >= ?'); params.push(from); }
    if (to && isValidDate(to)) { where.push('pickup_date <= ?'); params.push(to); }
    const sql = `SELECT id FROM bookings ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY pickup_date ASC, id ASC`;
    return db.prepare(sql).all(...params).map((r) => getBooking(r.id));
  }

  // Re-activating a cancelled booking must not double-book, so it re-checks availability.
  const updateTx = db.transaction((id, changes) => {
    const booking = getBooking(id);
    if (!booking) throw new BookingError('Booking not found', 404);
    if (changes.status !== undefined) {
      if (!STATUSES.includes(changes.status)) throw new BookingError('Unknown status.');
      const reactivating = RELEASING_STATUSES.includes(booking.status) && !RELEASING_STATUSES.includes(changes.status);
      if (reactivating) {
        const items = booking.items.map((i) => ({ product: getProduct(i.product_id), quantity: i.quantity }));
        const conflicts = checkItems(items, booking.pickup_date, booking.return_date, booking.id);
        if (conflicts.length)
          throw new BookingError('Those dates have since been booked by someone else.', 409, conflicts);
      }
      db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(changes.status, id);
    }
    if (changes.adminNotes !== undefined) {
      db.prepare('UPDATE bookings SET admin_notes = ? WHERE id = ?').run(String(changes.adminNotes).slice(0, 2000), id);
    }
    return getBooking(id);
  });

  function updateBooking(id, changes) {
    return updateTx.immediate(id, changes);
  }

  function stats() {
    const t = today();
    const one = (sql, ...p) => db.prepare(sql).get(...p).n;
    return {
      pending: one("SELECT COUNT(*) AS n FROM bookings WHERE status = 'pending'"),
      upcoming: one("SELECT COUNT(*) AS n FROM bookings WHERE status IN ('pending','confirmed') AND pickup_date >= ?", t),
      out: one("SELECT COUNT(*) AS n FROM bookings WHERE status = 'picked_up'"),
      dueBack: one("SELECT COUNT(*) AS n FROM bookings WHERE status = 'picked_up' AND return_date <= ?", t),
      total: one('SELECT COUNT(*) AS n FROM bookings'),
    };
  }

  function saveProduct(id, body) {
    const name = clean(body.name, 120, true, 'item name');
    const fields = {
      name,
      category: clean(body.category, 60, false) || 'Display',
      description: clean(body.description, 1000, false),
      price: Math.max(0, Number(body.price) || 0),
      stock: Math.max(0, Math.min(999, parseInt(body.stock, 10) || 0)),
      image_url: clean(body.imageUrl, 500, false),
      active: body.active === false || body.active === 0 ? 0 : 1,
    };
    if (fields.image_url && !/^https?:\/\//i.test(fields.image_url))
      throw new BookingError('Image URL must start with http:// or https://');
    if (id) {
      if (!getProduct(id)) throw new BookingError('Item not found', 404);
      db.prepare(`UPDATE products SET name=@name, category=@category, description=@description, price=@price,
                  stock=@stock, image_url=@image_url, active=@active WHERE id=@id`).run({ ...fields, id });
      return getProduct(id);
    }
    const { lastInsertRowid } = db.prepare(`INSERT INTO products (name, category, description, price, stock, image_url, active)
      VALUES (@name, @category, @description, @price, @stock, @image_url, @active)`).run(fields);
    return getProduct(lastInsertRowid);
  }

  return {
    listProducts, getProduct, availability, createBooking, getBooking, listBookings,
    updateBooking, stats, saveProduct,
  };
}

module.exports = {
  createBookingService, BookingError, STATUSES, MAX_RENTAL_DAYS, isValidDate, addDays, today,
};
