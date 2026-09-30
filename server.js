const { openDatabase } = require('./src/db');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
let adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword) {
  if (process.env.NODE_ENV === 'production') {
    console.error('ADMIN_PASSWORD must be set in production.');
    process.exit(1);
  }
  adminPassword = 'luxe-admin';
  console.warn('ADMIN_PASSWORD is not set – using the development password "luxe-admin".');
}

const db = openDatabase();
const app = createApp({
  db,
  adminPassword,
  sessionSecret: process.env.SESSION_SECRET,
  currency: process.env.CURRENCY,
});

app.listen(PORT, () => {
  console.log(`Luxe Display is running at http://localhost:${PORT}`);
  console.log(`Admin dashboard:            http://localhost:${PORT}/admin`);
});
