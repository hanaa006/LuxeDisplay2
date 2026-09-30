const test = require('node:test');
const assert = require('node:assert');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { addDays, today } = require('../src/bookings');

async function startServer() {
  const db = openDatabase(':memory:');
  const app = createApp({ db, adminPassword: 'secret', sessionSecret: 'test' });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };
  return { server, call };
}

const booking = (overrides = {}) => ({
  name: 'Jane Doe', email: 'jane@example.com', phone: '0123456789', eventType: 'Wedding',
  pickupDate: addDays(today(), 10), returnDate: addDays(today(), 12),
  items: [{ productId: 1, quantity: 1 }],
  ...overrides,
});

test('booking flow', async (t) => {
  const { server, call } = await startServer();
  t.after(() => server.close());

  await t.test('lists seeded products', async () => {
    const res = await call('GET', '/api/products');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.length >= 3);
  });

  await t.test('creates a booking', async () => {
    const res = await call('POST', '/api/bookings', booking());
    assert.strictEqual(res.status, 201);
    assert.match(res.body.reference, /^LD-[0-9A-F]{6}$/);
  });

  await t.test('refuses the same dates for the same item', async () => {
    const res = await call('POST', '/api/bookings', booking({ email: 'other@example.com' }));
    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(res.body.conflicts[0].dates.length, 3);
  });

  await t.test('refuses a range that overlaps just one booked day', async () => {
    const res = await call('POST', '/api/bookings', booking({
      pickupDate: addDays(today(), 12), returnDate: addDays(today(), 14),
    }));
    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(res.body.conflicts[0].dates, [addDays(today(), 12)]);
  });

  await t.test('allows the next free day', async () => {
    const res = await call('POST', '/api/bookings', booking({
      pickupDate: addDays(today(), 13), returnDate: addDays(today(), 13),
    }));
    assert.strictEqual(res.status, 201);
  });

  await t.test('allows a different item on the same dates', async () => {
    const res = await call('POST', '/api/bookings', booking({ items: [{ productId: 2, quantity: 1 }] }));
    assert.strictEqual(res.status, 201);
  });

  await t.test('availability shows booked dates', async () => {
    const res = await call('GET', `/api/products/1/availability?from=${today()}&to=${addDays(today(), 20)}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reserved[addDays(today(), 11)], 1);
    assert.strictEqual(res.body.reserved[addDays(today(), 15)], undefined);
  });

  await t.test('rejects past dates and reversed ranges', async () => {
    let res = await call('POST', '/api/bookings', booking({ pickupDate: addDays(today(), -1) }));
    assert.strictEqual(res.status, 400);
    res = await call('POST', '/api/bookings', booking({ pickupDate: addDays(today(), 5), returnDate: addDays(today(), 4) }));
    assert.strictEqual(res.status, 400);
  });

  await t.test('only one of many simultaneous requests for the same date wins', async () => {
    const day = addDays(today(), 40);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      call('POST', '/api/bookings', booking({ email: `u${i}@example.com`, pickupDate: day, returnDate: day }))));
    assert.strictEqual(results.filter((r) => r.status === 201).length, 1);
    assert.strictEqual(results.filter((r) => r.status === 409).length, 9);
  });

  await t.test('admin endpoints require login', async () => {
    const res = await call('GET', '/api/admin/bookings');
    assert.strictEqual(res.status, 401);
    const bad = await call('POST', '/api/admin/login', { password: 'nope' });
    assert.strictEqual(bad.status, 401);
  });

  await t.test('admin sees orders and cancelling frees the dates', async () => {
    const login = await call('POST', '/api/admin/login', { password: 'secret' });
    assert.strictEqual(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const list = await call('GET', '/api/admin/bookings', null, { cookie });
    assert.strictEqual(list.status, 200);
    const first = list.body.find((b) => b.pickup_date === addDays(today(), 10) && b.items[0].product_id === 1);
    assert.ok(first);

    const cancel = await call('PATCH', `/api/admin/bookings/${first.id}`, { status: 'cancelled' }, { cookie });
    assert.strictEqual(cancel.status, 200);

    const rebook = await call('POST', '/api/bookings', booking({ email: 'new@example.com' }));
    assert.strictEqual(rebook.status, 201);

    // The cancelled order can't be revived now that someone else holds its dates.
    const revive = await call('PATCH', `/api/admin/bookings/${first.id}`, { status: 'confirmed' }, { cookie });
    assert.strictEqual(revive.status, 409);
  });
});

test('stock above one allows that many overlapping bookings', async (t) => {
  const { server, call } = await startServer();
  t.after(() => server.close());
  const login = await call('POST', '/api/admin/login', { password: 'secret' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const created = await call('POST', '/api/admin/products', { name: 'Chair covers', price: 2, stock: 2 }, { cookie });
  const items = [{ productId: created.body.id, quantity: 1 }];

  assert.strictEqual((await call('POST', '/api/bookings', booking({ items }))).status, 201);
  assert.strictEqual((await call('POST', '/api/bookings', booking({ items }))).status, 201);
  assert.strictEqual((await call('POST', '/api/bookings', booking({ items }))).status, 409);
});
