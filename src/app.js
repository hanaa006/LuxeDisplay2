const path = require('path');
const express = require('express');
const { createBookingService, BookingError, isValidDate, addDays, today, STATUSES } = require('./bookings');
const { createAuth } = require('./auth');

function createApp({ db, adminPassword, sessionSecret, currency }) {
  const app = express();
  const service = createBookingService(db);
  const auth = createAuth({ password: adminPassword, secret: sessionSecret });

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));

  // Simple per-IP limiter for the public booking and login endpoints.
  const hits = new Map();
  function rateLimit(max, windowMs) {
    return (req, res, next) => {
      const key = `${req.path}:${req.ip}`;
      const now = Date.now();
      const entry = hits.get(key) || { count: 0, reset: now + windowMs };
      if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
      entry.count += 1;
      hits.set(key, entry);
      if (entry.count > max) return res.status(429).json({ error: 'Too many attempts. Please try again shortly.' });
      next();
    };
  }

  const wrap = (fn) => (req, res) => {
    try {
      const result = fn(req, res);
      if (result !== undefined) res.json(result);
    } catch (err) {
      if (err instanceof BookingError) {
        return res.status(err.status).json({ error: err.message, conflicts: err.details });
      }
      console.error(err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };

  // ---------- Public API ----------
  app.get('/api/config', (req, res) => res.json({ currency: currency || 'GBP' }));
  app.get('/api/products', wrap(() => service.listProducts()));

  app.get('/api/products/:id/availability', wrap((req) => {
    const from = isValidDate(req.query.from) ? req.query.from : today();
    let to = isValidDate(req.query.to) ? req.query.to : addDays(from, 180);
    if (to < from) to = from;
    if (to > addDays(from, 400)) to = addDays(from, 400);
    return service.availability(Number(req.params.id), from, to);
  }));

  app.post('/api/bookings', rateLimit(20, 60 * 60 * 1000), wrap((req, res) => {
    const booking = service.createBooking(req.body || {});
    res.status(201).json({
      reference: booking.reference,
      pickupDate: booking.pickup_date,
      returnDate: booking.return_date,
      total: booking.total,
      items: booking.items.map((i) => ({ name: i.name, quantity: i.quantity })),
    });
  }));

  // ---------- Admin API ----------
  app.post('/api/admin/login', rateLimit(10, 15 * 60 * 1000), auth.login);
  app.post('/api/admin/logout', auth.logout);
  app.get('/api/admin/session', (req, res) => res.json({ loggedIn: auth.isLoggedIn(req) }));

  const admin = express.Router();
  admin.use(auth.requireAdmin);
  admin.get('/stats', wrap(() => service.stats()));
  admin.get('/statuses', wrap(() => STATUSES));
  admin.get('/bookings', wrap((req) => service.listBookings(req.query)));
  admin.get('/bookings/:id', wrap((req) => {
    const booking = service.getBooking(Number(req.params.id));
    if (!booking) throw new BookingError('Booking not found', 404);
    return booking;
  }));
  admin.patch('/bookings/:id', wrap((req) => service.updateBooking(Number(req.params.id), req.body || {})));
  admin.get('/products', wrap(() => service.listProducts({ includeInactive: true })));
  admin.post('/products', wrap((req) => service.saveProduct(null, req.body || {})));
  admin.put('/products/:id', wrap((req) => service.saveProduct(Number(req.params.id), req.body || {})));
  app.use('/api/admin', admin);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // ---------- Pages ----------
  app.use('/vendor/flatpickr', express.static(path.join(path.dirname(require.resolve('flatpickr')), '..', 'dist')));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  return app;
}

module.exports = { createApp };
