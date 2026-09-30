(() => {
  const STATUS_LABELS = {
    pending: 'Pending', confirmed: 'Confirmed', picked_up: 'Picked up', returned: 'Returned', cancelled: 'Cancelled',
  };
  const state = { currency: 'GBP', bookings: [], products: [] };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency: state.currency }).format(n);
  const pad = (n) => String(n).padStart(2, '0');
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const pretty = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const badge = (s) => `<span class="badge badge-${esc(s)}">${esc(STATUS_LABELS[s] || s)}</span>`;

  async function api(path, options = {}) {
    const res = await fetch(`/api/admin${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') { showLogin(); throw new Error(data.error || 'Please log in.'); }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { data });
    return data;
  }

  // ---------- Auth ----------
  function showLogin() {
    $('login-view').hidden = false;
    $('app-view').hidden = true;
    $('logout').hidden = true;
    $('password').focus();
  }

  async function showApp() {
    $('login-view').hidden = true;
    $('app-view').hidden = false;
    $('logout').hidden = false;
    await Promise.all([loadStats(), loadOrders(), loadProducts()]);
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-error').hidden = true;
    try {
      await api('/login', { method: 'POST', body: { password: $('password').value } });
      $('password').value = '';
      await showApp();
    } catch (err) {
      $('login-error').textContent = err.message;
      $('login-error').hidden = false;
    }
  });

  $('logout').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });

  // ---------- Tabs ----------
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('tab-orders').hidden = tab.dataset.tab !== 'orders';
    $('tab-items').hidden = tab.dataset.tab !== 'items';
  }));

  // ---------- Stats ----------
  async function loadStats() {
    const s = await api('/stats');
    const tiles = [
      [s.pending, 'Awaiting confirmation'],
      [s.upcoming, 'Upcoming pick-ups'],
      [s.out, 'Currently out'],
      [s.dueBack, 'Due back / overdue'],
      [s.total, 'All-time orders'],
    ];
    $('stats').innerHTML = tiles.map(([n, l]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
  }

  // ---------- Orders ----------
  $('status-filter').innerHTML += Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

  async function loadOrders() {
    const params = new URLSearchParams();
    const q = $('search').value.trim();
    const status = $('status-filter').value;
    const when = $('when-filter').value;
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (when === 'upcoming') params.set('from', todayIso());
    if (when === 'past') params.set('to', todayIso());
    let bookings = await api(`/bookings?${params}`);
    if (when === 'past') bookings = bookings.filter((b) => b.return_date < todayIso()).reverse();
    state.bookings = bookings;
    renderOrders();
  }

  function renderOrders() {
    $('orders-empty').hidden = state.bookings.length > 0;
    $('orders-body').innerHTML = state.bookings.map((b) => `
      <tr class="clickable" data-id="${b.id}">
        <td class="ref">${esc(b.reference)}</td>
        <td>${esc(b.customer_name)}<div class="sub">${esc(b.phone)}</div></td>
        <td>${b.items.map((i) => `${i.quantity > 1 ? `${i.quantity} × ` : ''}${esc(i.name)}`).join('<br>')}</td>
        <td class="nowrap">${pretty(b.pickup_date)}</td>
        <td class="nowrap">${pretty(b.return_date)}</td>
        <td class="nowrap">${money(b.total)}</td>
        <td>${badge(b.status)}</td>
      </tr>`).join('');
  }

  let searchTimer;
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadOrders, 250); });
  $('status-filter').addEventListener('change', loadOrders);
  $('when-filter').addEventListener('change', loadOrders);
  $('orders-body').addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (row) openOrder(Number(row.dataset.id));
  });

  // ---------- Drawers ----------
  function openDrawer(id) { $('drawer-backdrop').hidden = false; $(id).hidden = false; }
  function closeDrawers() {
    $('drawer-backdrop').hidden = true;
    $('order-drawer').hidden = true;
    $('item-drawer').hidden = true;
  }
  $('drawer-backdrop').addEventListener('click', closeDrawers);
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeDrawers));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawers(); });

  async function openOrder(id) {
    const b = await api(`/bookings/${id}`);
    $('order-detail').innerHTML = `
      <div class="eyebrow">Order ${esc(b.reference)}</div>
      <h2>${esc(b.customer_name)}</h2>
      <p>${badge(b.status)}</p>
      <div id="order-error" class="alert alert-error" hidden></div>
      <div id="order-ok" class="alert alert-ok" hidden>Saved.</div>
      <h4>Dates</h4>
      <dl>
        <dt>Pick-up</dt><dd>${pretty(b.pickup_date)}</dd>
        <dt>Drop-off</dt><dd>${pretty(b.return_date)}</dd>
      </dl>
      <h4>Contact</h4>
      <dl>
        <dt>Phone</dt><dd><a href="tel:${esc(b.phone)}">${esc(b.phone)}</a></dd>
        <dt>Email</dt><dd><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></dd>
        <dt>Event</dt><dd>${esc(b.event_type) || '—'}</dd>
        <dt>Booked on</dt><dd>${esc(new Date(`${b.created_at.replace(' ', 'T')}Z`).toLocaleString())}</dd>
      </dl>
      <h4>Items</h4>
      <dl>
        ${b.items.map((i) => `<dt>${i.quantity} ×</dt><dd>${esc(i.name)} <span class="muted">(${money(i.unit_price)} each)</span></dd>`).join('')}
        <dt>Total</dt><dd><strong>${money(b.total)}</strong></dd>
      </dl>
      ${b.notes ? `<h4>Customer notes</h4><p>${esc(b.notes)}</p>` : ''}
      <h4>Manage</h4>
      <form id="order-form">
        <div class="field">
          <label for="order-status">Status</label>
          <select id="order-status">${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${v === b.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div id="cancel-warning" class="alert alert-error" hidden>Saving will cancel this order and make its dates available to other customers.</div>
        <div class="field">
          <label for="order-notes">Private notes</label>
          <textarea id="order-notes" placeholder="Deposit paid, collection time…">${esc(b.admin_notes)}</textarea>
        </div>
        <button class="btn btn-block" type="submit">Save changes</button>
        <p class="muted" style="font-size:.85rem;margin-top:10px">Cancelling an order frees up its dates for other customers.</p>
      </form>`;
    openDrawer('order-drawer');

    $('order-status').addEventListener('change', () => {
      $('cancel-warning').hidden = !($('order-status').value === 'cancelled' && b.status !== 'cancelled');
    });

    $('order-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('order-error').hidden = true;
      $('order-ok').hidden = true;
      const status = $('order-status').value;
      try {
        await api(`/bookings/${id}`, { method: 'PATCH', body: { status, adminNotes: $('order-notes').value } });
        $('order-ok').hidden = false;
        b.status = status;
        $('cancel-warning').hidden = true;
        await Promise.all([loadOrders(), loadStats()]);
      } catch (err) {
        $('order-error').textContent = err.message;
        $('order-error').hidden = false;
      }
    });
  }

  // ---------- Items ----------
  async function loadProducts() {
    state.products = await api('/products');
    $('items-body').innerHTML = state.products.map((p) => `
      <tr>
        <td>${esc(p.name)}<div class="sub">${esc(p.description).slice(0, 80)}</div></td>
        <td>${esc(p.category)}</td>
        <td class="nowrap">${money(p.price)}</td>
        <td>${p.stock}</td>
        <td>${p.active ? 'Yes' : '<span class="muted">Hidden</span>'}</td>
        <td><button class="btn btn-sm btn-outline" data-edit="${p.id}" type="button">Edit</button></td>
      </tr>`).join('');
  }

  function openItem(product) {
    const f = $('item-form');
    $('item-title').textContent = product ? 'Edit item' : 'Add item';
    $('item-error').hidden = true;
    f.id.value = product ? product.id : '';
    f.name.value = product ? product.name : '';
    f.category.value = product ? product.category : '';
    f.description.value = product ? product.description : '';
    f.price.value = product ? product.price : '';
    f.stock.value = product ? product.stock : 1;
    f.imageUrl.value = product ? product.image_url : '';
    f.active.checked = product ? !!product.active : true;
    openDrawer('item-drawer');
  }

  $('new-item').addEventListener('click', () => openItem(null));
  $('items-body').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit]');
    if (btn) openItem(state.products.find((p) => p.id === Number(btn.dataset.edit)));
  });

  $('item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const body = {
      name: f.name.value, category: f.category.value, description: f.description.value,
      price: f.price.value, stock: f.stock.value, imageUrl: f.imageUrl.value, active: f.active.checked,
    };
    try {
      await api(f.id.value ? `/products/${f.id.value}` : '/products', { method: f.id.value ? 'PUT' : 'POST', body });
      closeDrawers();
      await loadProducts();
    } catch (err) {
      $('item-error').textContent = err.message;
      $('item-error').hidden = false;
    }
  });

  // ---------- Init ----------
  (async () => {
    const config = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
    state.currency = config.currency || 'GBP';
    const { loggedIn } = await fetch('/api/admin/session').then((r) => r.json());
    if (loggedIn) await showApp(); else showLogin();
  })();
})();
